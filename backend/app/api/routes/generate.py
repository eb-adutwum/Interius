import json
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select
from sse_starlette.sse import EventSourceResponse

from app.agent.interface import (
    InterfaceAgent,
    InterfaceAttachmentSummary,
    InterfaceContextMessage,
    InterfaceDecision,
)
from app.agent.artifacts import ProjectCharter, SystemArchitecture
from app.agent.orchestrator import run_pipeline_generator
from app.agent.rag import format_thread_generated_file_context, get_rag_manager
from app.agent.llm_client import LLMClient
from app.api.deps import CurrentUser, get_db
from app.core.config import settings
from app.crud import create_generation_run, create_project, create_user, get_user_by_email
from app.models import GenerationRunCreate, Project, ProjectCreate, User, UserCreate

router = APIRouter()
logger = logging.getLogger(__name__)
GENERATION_RUN_PROMPT_MAX_CHARS = 5000


class InterfacePromptRequest(BaseModel):
    prompt: str
    thread_id: str | None = None
    recent_messages: list[InterfaceContextMessage] = Field(default_factory=list)
    attachment_summaries: list[InterfaceAttachmentSummary] = Field(default_factory=list)


class ThreadContextFile(BaseModel):
    filename: str
    mime_type: str | None = None
    size_bytes: int | None = None
    has_text_content: bool = False
    text_content: str | None = None


class ChatGenerateStreamRequest(BaseModel):
    prompt: str
    recent_messages: list[InterfaceContextMessage] = Field(default_factory=list)
    attachment_summaries: list[InterfaceAttachmentSummary] = Field(default_factory=list)
    thread_context_files: list[ThreadContextFile] = Field(default_factory=list)
    stop_after_architecture: bool = False
    resume_from_stage: str | None = None  # currently supports "post_architecture"
    approved_requirements_artifact: dict[str, Any] | None = None
    approved_architecture_artifact: dict[str, Any] | None = None


def _charter_to_markdown(artifact: dict[str, Any]) -> str:
    project_name = artifact.get("project_name") or "Project"
    description = artifact.get("description") or ""
    auth_required = artifact.get("auth_required")
    entities = artifact.get("entities") or []
    endpoints = artifact.get("endpoints") or []
    business_rules = artifact.get("business_rules") or []

    lines: list[str] = [f"# Requirements Document: {project_name}", ""]
    if description:
        lines += [description, ""]

    if auth_required is not None:
        lines += [f"**Authentication required:** {'Yes' if auth_required else 'No'}", ""]

    lines += ["## Entities", ""]
    if entities:
        for entity in entities:
            lines.append(f"### {entity.get('name', 'Entity')}")
            fields = entity.get("fields") or []
            if not fields:
                lines.append("- No fields extracted")
            for fld in fields:
                req = "required" if fld.get("required") else "optional"
                lines.append(
                    f"- `{fld.get('name', 'field')}`: `{fld.get('field_type', 'unknown')}` ({req})"
                )
            lines.append("")
    else:
        lines += ["- No entities extracted", ""]

    lines += ["## Endpoints", ""]
    if endpoints:
        for ep in endpoints:
            lines.append(
                f"- **{ep.get('method', 'GET')}** `{ep.get('path', '/')}` - {ep.get('description', '')}"
            )
    else:
        lines.append("- No endpoints extracted")
    lines.append("")

    if business_rules:
        lines += ["## Business Rules", ""]
        lines.extend([f"- {rule}" for rule in business_rules])
        lines.append("")

    return "\n".join(lines).strip()


def _slug_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")


def _candidate_entity_keys(value: str) -> list[str]:
    slug = _slug_name(value)
    if not slug:
        return []

    keys = [slug]
    if slug.endswith("ies") and len(slug) > 3:
        keys.append(f"{slug[:-3]}y")
    if slug.endswith("s") and len(slug) > 1:
        keys.append(slug[:-1])
    else:
        keys.append(f"{slug}s")
    return list(dict.fromkeys(k for k in keys if k))


def _build_schema_visualizer_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    entities = artifact.get("entities") or []
    project_name = artifact.get("project_name") or "Project"

    entity_lookup: dict[str, str] = {}
    tables: list[dict[str, Any]] = []

    for entity in entities:
        table_name = str(entity.get("name") or "Entity").strip() or "Entity"
        for key in _candidate_entity_keys(table_name):
            entity_lookup.setdefault(key, table_name)

    relationships: list[dict[str, Any]] = []
    seen_relationships: set[tuple[str, str, str, str]] = set()

    for entity in entities:
        table_name = str(entity.get("name") or "Entity").strip() or "Entity"
        fields = entity.get("fields") or []
        columns: list[dict[str, Any]] = []

        for field in fields:
            field_name = str(field.get("name") or "field").strip() or "field"
            field_type = str(field.get("field_type") or "unknown").strip() or "unknown"
            required = bool(field.get("required", True))
            field_slug = _slug_name(field_name)
            is_primary_key = field_slug == "id"

            foreign_key: dict[str, str] | None = None
            if field_slug.endswith("_id") and field_slug != "id":
                target_key = field_slug[:-3]
                target_table = entity_lookup.get(target_key)
                if target_table and target_table != table_name:
                    foreign_key = {"table": target_table, "column": "id"}
                    rel_key = (table_name, field_name, target_table, "id")
                    if rel_key not in seen_relationships:
                        relationships.append(
                            {
                                "from_table": table_name,
                                "from_column": field_name,
                                "to_table": target_table,
                                "to_column": "id",
                                "kind": "many-to-one",
                            }
                        )
                        seen_relationships.add(rel_key)

            columns.append(
                {
                    "name": field_name,
                    "type": field_type,
                    "nullable": not required,
                    "is_primary_key": is_primary_key,
                    "foreign_key": foreign_key,
                }
            )

        if columns and not any(col.get("is_primary_key") for col in columns):
            inferred_pk = next(
                (col for col in columns if _slug_name(str(col.get("name") or "")) == f"{_slug_name(table_name)}_id"),
                None,
            )
            if inferred_pk:
                inferred_pk["is_primary_key"] = True

        tables.append(
            {
                "name": table_name,
                "columns": columns,
            }
        )

    return {
        "version": 1,
        "title": f"{project_name} ER Diagram",
        "tables": tables,
        "relationships": relationships,
    }


def _build_context_block(thread_context_files: list[ThreadContextFile]) -> str:
    usable = [f for f in thread_context_files if f.has_text_content and (f.text_content or "").strip()]
    if not usable:
        return ""

    sections: list[str] = [
        "Attached Thread Context Files (use as supporting requirements context):",
    ]
    for file in usable[:5]:
        content = (file.text_content or "").strip()
        if not content:
            continue
        sections += [
            f"\n[File: {file.filename}]",
            content[:12000],
        ]
    return "\n".join(sections).strip()


def _ui_event(event: str, **payload: Any) -> str:
    return json.dumps({"status": event, **payload})


def _chat_thread_project_marker(thread_id: str) -> str:
    return f"[chat-thread:{thread_id}]"


def _truncate_prompt_for_generation_run(prompt: str) -> str:
    text = (prompt or "").strip()
    if len(text) <= GENERATION_RUN_PROMPT_MAX_CHARS:
        return text
    suffix = "\n\n[truncated for run record]"
    keep = max(0, GENERATION_RUN_PROMPT_MAX_CHARS - len(suffix))
    return text[:keep].rstrip() + suffix


def _derive_project_name_from_prompt(prompt: str, thread_id: str) -> str:
    text = (prompt or "").strip()
    if not text:
        return f"Chat Thread {thread_id[:8]}"
    cleaned = " ".join(text.split())
    return (cleaned[:80]).strip() or f"Chat Thread {thread_id[:8]}"


THREAD_CODE_QA_SYSTEM_PROMPT = """
You are Interius, answering questions about code generated in the current chat thread.

Rules:
- Use only the retrieved code snippets provided to you.
- Be explicit about uncertainty when the snippets are insufficient.
- Mention relevant files inline using backticks, including line numbers when provided.
- Focus on explanation, traceability, and practical understanding of the generated code.
- Do not invent files, functions, or behavior that are not present in the snippets.
""".strip()


def _fallback_thread_code_answer(snippets: list[dict[str, Any]]) -> str:
    refs: list[str] = []
    for snippet in snippets[:3]:
        filename = snippet.get("filename") or "unknown"
        start_line = snippet.get("start_line")
        if start_line:
            refs.append(f"`{filename}:{start_line}`")
        else:
            refs.append(f"`{filename}`")
    joined = ", ".join(refs)
    if not joined:
        return (
            "Interius couldn't explain the generated code right now, but I also couldn't find "
            "relevant snippets in this thread."
        )
    return (
        "Interius found relevant generated code in this thread, but I couldn't produce a grounded "
        f"explanation just now. Start with {joined}."
    )


async def _answer_thread_code_question(thread_id: str, prompt: str) -> str:
    snippets = get_rag_manager().query_thread_generated_files(thread_id, prompt, n_results=5)
    if not snippets:
        return (
            "Interius couldn't find generated code indexed for this thread yet. "
            "Generate code in this thread first, then ask about a file, route, or flow."
        )

    context = format_thread_generated_file_context(snippets)
    llm = LLMClient(
        model_name=settings.MODEL_INTERFACE,
        base_url=settings.INTERFACE_LLM_BASE_URL or None,
        api_key=settings.INTERFACE_LLM_API_KEY or None,
    )
    try:
        return await llm.generate_plain_text(
            system_prompt=THREAD_CODE_QA_SYSTEM_PROMPT,
            user_prompt=(
                f"User question:\n{prompt}\n\n"
                f"Retrieved snippets:\n{context}\n\n"
                "Answer the user's question using only the snippets above."
            ),
            temperature=0.2,
        )
    except Exception as exc:
        logger.warning("Thread code QA fallback triggered for thread %s: %s", thread_id, exc)
        return _fallback_thread_code_answer(snippets)


def _resolve_or_create_project_for_thread(
    session: Session,
    current_user: Any,
    thread_id: str,
    prompt: str,
) -> uuid.UUID:
    marker = _chat_thread_project_marker(thread_id)
    existing = session.exec(
        select(Project).where(
            Project.owner_id == current_user.id,
            Project.description == marker,
        )
    ).first()
    if existing:
        return existing.id

    project = create_project(
        session=session,
        project_in=ProjectCreate(
            name=_derive_project_name_from_prompt(prompt, thread_id),
            description=marker,
        ),
        owner_id=current_user.id,
    )
    return project.id


def _get_or_create_chat_bridge_user(session: Session) -> User:
    """
    Temporary UI bridge:
    the chat frontend currently authenticates with Supabase, not backend JWTs.
    For the thread-chat streaming endpoint, use a stable backend user so the UI
    can exercise the real orchestrator path without backend token wiring yet.
    """
    existing = get_user_by_email(session=session, email=str(settings.FIRST_SUPERUSER))
    if existing:
        return existing

    return create_user(
        session=session,
        user_create=UserCreate(
            email=str(settings.FIRST_SUPERUSER),
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_active=True,
            is_superuser=True,
            full_name="Interius Chat Bridge",
        ),
    )


async def run_interface_then_pipeline_ui_stream(
    session: Session,
    project_id: uuid.UUID,
    payload: ChatGenerateStreamRequest,
    *,
    thread_id: str | None = None,
):
    """
    UI-first streaming wrapper.
    Emits normalized events that map cleanly to the current ChatPage renderer:
    progress stages + requirements/architecture docs + generated files + final summary.
    """
    prompt = payload.prompt
    routed_prompt = prompt
    decision = None

    is_resume_from_architecture = (payload.resume_from_stage or "").strip().lower() == "post_architecture"
    approved_charter_obj: ProjectCharter | None = None
    approved_arch_obj: SystemArchitecture | None = None

    if is_resume_from_architecture:
        try:
            if not payload.approved_architecture_artifact:
                raise ValueError("Missing approved architecture artifact for resume")
            approved_arch_obj = SystemArchitecture.model_validate(payload.approved_architecture_artifact)
            if payload.approved_requirements_artifact:
                approved_charter_obj = ProjectCharter.model_validate(payload.approved_requirements_artifact)
            yield _ui_event(
                "intent_routed",
                intent="resume_pipeline",
                trigger_pipeline=True,
                message="Interius is resuming generation from the approved architecture.",
            )
        except Exception as exc:
            yield _ui_event("error", message=f"Unable to resume from approval checkpoint: {exc}")
            return

    if not is_resume_from_architecture:
        try:
            decision = await InterfaceAgent().run(
                prompt,
                recent_messages=payload.recent_messages,
                attachment_summaries=payload.attachment_summaries,
            )
            if not decision.should_trigger_pipeline:
                yield _ui_event(
                    "chat_reply",
                    intent=decision.intent,
                    trigger_pipeline=False,
                    message=decision.assistant_reply,
                )
                yield _ui_event(
                    "completed",
                    mode="chat_only",
                    trigger_pipeline=False,
                )
                return

            routed_prompt = decision.pipeline_prompt or prompt
            yield _ui_event(
                "intent_routed",
                intent=decision.intent,
                trigger_pipeline=True,
                message=decision.assistant_reply,
            )
        except Exception as exc:
            logger.warning("Interface agent failed in UI stream; proceeding directly to pipeline: %s", exc)
            yield _ui_event(
                "intent_routed",
                intent="fallback_pipeline",
                trigger_pipeline=True,
                message="Interius is starting generation for your request.",
            )

    context_block = _build_context_block(payload.thread_context_files)
    pipeline_prompt = f"{routed_prompt}\n\n{context_block}".strip() if context_block else routed_prompt

    run = create_generation_run(
        session=session,
        run_in=GenerationRunCreate(
            project_id=project_id,
            prompt=_truncate_prompt_for_generation_run(pipeline_prompt),
        ),
    )

    captured: dict[str, Any] = {
        "requirements": None,
        "architecture": None,
        "code_files": None,
        "dependencies": None,
        "review": None,
    }

    stage_map = {
        "requirements": ("requirements", 1, "req"),
        "architecture": ("architecture", 1, "arch"),
        "implementer": ("implementer", 2, "code"),
        "reviewer": ("reviewer", 2, "review"),
        "tester": ("tester", 2, "review"),
    }

    async for raw_event in run_pipeline_generator(
        session,
        project_id,
        run.id,
        pipeline_prompt,
        charter_override=approved_charter_obj,
        architecture_override=approved_arch_obj,
        start_stage="implementer" if is_resume_from_architecture else "requirements",
    ):
        try:
            event = json.loads(raw_event)
        except Exception:
            yield _ui_event("error", message="Invalid pipeline event received")
            continue

        status = event.get("status")

        if status == "starting":
            yield _ui_event("run_started", message=event.get("message", "Initializing pipeline..."))
            continue

        if status in stage_map:
            stage, phase, step = stage_map[status]
            yield _ui_event(
                "stage_started",
                stage=stage,
                phase=phase,
                step=step,
                message=event.get("message"),
            )
            continue

        if status == "requirements_done":
            artifact = event.get("artifact") or {}
            captured["requirements"] = artifact
            schema_artifact = _build_schema_visualizer_artifact(artifact)
            yield _ui_event("stage_completed", stage="requirements", phase=1, step="req")
            yield _ui_event(
                "artifact_requirements",
                artifact=artifact,
                preview_file={
                    "path": "Requirements Document.md",
                    "content": _charter_to_markdown(artifact),
                },
                schema_file={
                    "path": "ER Diagram.schema.json",
                    "content": json.dumps(schema_artifact, indent=2),
                },
            )
            continue

        if status == "architecture_done":
            artifact = event.get("artifact") or {}
            captured["architecture"] = artifact
            design_doc = artifact.get("design_document") or "# Architecture Design\n\nNo design document provided."
            mermaid_diagram = (artifact.get("mermaid_diagram") or "").strip()
            yield _ui_event("stage_completed", stage="architecture", phase=1, step="arch")
            architecture_event_payload: dict[str, Any] = {
                "artifact": artifact,
                "preview_file": {
                    "path": "Architecture Design.md",
                    "content": design_doc,
                },
            }
            if mermaid_diagram:
                architecture_event_payload["diagram_file"] = {
                    "path": "Architecture Diagram.mmd",
                    "content": mermaid_diagram,
                }
            yield _ui_event("artifact_architecture", **architecture_event_payload)
            if payload.stop_after_architecture:
                req = captured.get("requirements") or {}
                project_name = req.get("project_name") or "backend"
                yield _ui_event(
                    "awaiting_approval",
                    mode="pipeline",
                    trigger_pipeline=True,
                    message="Requirements and architecture are ready for your approval.",
                    summary=f"Interius prepared requirements and architecture artifacts for {project_name}.",
                    requirements_artifact=captured.get("requirements"),
                    architecture_artifact=captured.get("architecture"),
                )
                return
            continue

        if status == "implementer_done":
            artifact = event.get("artifact") or {}
            files = artifact.get("files") or []
            dependencies = artifact.get("dependencies") or []
            captured["code_files"] = files
            captured["dependencies"] = dependencies
            yield _ui_event("stage_completed", stage="implementer", phase=2, step="code")
            yield _ui_event(
                "artifact_files",
                files=files,
                dependencies=dependencies,
                files_count=event.get("files_count", len(files)),
            )
            continue

        if status == "revision":
            yield _ui_event(
                "review_update",
                kind="revision",
                message=event.get("message"),
                attempt=event.get("attempt"),
                issues_count=event.get("issues_count"),
                affected_files=event.get("affected_files") or [],
            )
            continue

        if status == "reviewer_done":
            review_artifact = event.get("artifact") or {}
            captured["review"] = review_artifact
            final_code = review_artifact.get("final_code") or []
            if final_code:
                captured["code_files"] = final_code
            yield _ui_event("stage_completed", stage="reviewer", phase=2, step="review")
            yield _ui_event(
                "review_update",
                kind="completed",
                message=event.get("message"),
                artifact=review_artifact,
            )
            continue

        if status == "tester_done":
            yield _ui_event("stage_completed", stage="tester", phase=2, step="review")
            yield _ui_event(
                "review_update",
                kind="tests",
                message=event.get("message"),
                artifact=event.get("artifact") or {},
                affected_files=[
                    req.get("path")
                    for req in ((event.get("artifact") or {}).get("patch_requests") or [])
                    if isinstance(req, dict) and req.get("path")
                ],
            )
            continue

        if status == "completed":
            final_artifact = event.get("artifact") or {}
            final_code = final_artifact.get("final_code") or []
            if final_code:
                captured["code_files"] = final_code
            if thread_id and captured.get("code_files"):
                try:
                    get_rag_manager().replace_thread_generated_files(thread_id, captured["code_files"] or [])
                except Exception as exc:
                    logger.warning("Failed to index generated files for thread %s: %s", thread_id, exc)
            req = captured.get("requirements") or {}
            project_name = req.get("project_name") or "backend"
            endpoints = req.get("endpoints") or []
            files = captured.get("code_files") or []
            summary = (
                f"Interius generated a backend scaffold for {project_name} "
                f"with {len(endpoints)} endpoint(s) and {len(files)} file(s)."
            )
            yield _ui_event(
                "completed",
                mode="pipeline",
                trigger_pipeline=True,
                message=event.get("message"),
                summary=summary,
                final_artifact=final_artifact,
                requirements_artifact=captured.get("requirements"),
                architecture_artifact=captured.get("architecture"),
                files=captured.get("code_files") or [],
                dependencies=captured.get("dependencies") or [],
            )
            continue

        if status == "error":
            yield _ui_event("error", message=event.get("message", "Pipeline failed"))
            continue

        # Forward unknown events for debugging/adaptation without breaking the stream.
        yield _ui_event("debug_event", raw=event)


@router.post("/interface", response_model=InterfaceDecision)
async def route_interface_prompt(payload: InterfacePromptRequest) -> InterfaceDecision:
    """
    Intent-only endpoint for the frontend chat UI.
    Returns a normal conversational reply or a pipeline-routing decision.
    """
    try:
        agent = InterfaceAgent()
        decision = await agent.run(
            payload.prompt,
            recent_messages=payload.recent_messages,
            attachment_summaries=payload.attachment_summaries,
        )
        if (
            payload.thread_id
            and not decision.should_trigger_pipeline
            and agent.looks_like_thread_code_question(payload.prompt, payload.recent_messages)
        ):
            grounded_reply = await _answer_thread_code_question(payload.thread_id, payload.prompt)
            return decision.model_copy(
                update={
                    "intent": "context_question",
                    "action_type": "chat",
                    "assistant_reply": grounded_reply,
                    "pipeline_prompt": None,
                    "execution_plan": None,
                }
            )
        return decision
    except Exception as exc:
        logger.warning("Interface-only route failed; returning pipeline fallback: %s", exc)
        return InterfaceDecision(
            intent="pipeline_request",
            should_trigger_pipeline=True,
            assistant_reply="Starting generation pipeline.",
            pipeline_prompt=payload.prompt,
        )


async def run_interface_then_pipeline_generator(
    session: Session,
    project_id: uuid.UUID,
    prompt: str,
):
    """
    Route the prompt through an interface/intent agent before deciding whether to run
    the full generation orchestrator.
    """
    routed_prompt = prompt
    decision = None

    try:
        decision = await InterfaceAgent().run(prompt)
        if not decision.should_trigger_pipeline:
            yield json.dumps(
                {
                    "status": "chat_reply",
                    "intent": decision.intent,
                    "trigger_pipeline": False,
                    "message": decision.assistant_reply,
                }
            )
            yield json.dumps(
                {
                    "status": "completed",
                    "mode": "chat_only",
                    "trigger_pipeline": False,
                }
            )
            return

        routed_prompt = decision.pipeline_prompt or prompt
        yield json.dumps(
            {
                "status": "intent_routed",
                "intent": decision.intent,
                "trigger_pipeline": True,
                "message": decision.assistant_reply,
            }
        )
    except Exception as exc:
        # Fail open so the generation feature still works if the interface model has issues.
        logger.warning("Interface agent failed; proceeding directly to pipeline: %s", exc)
        yield json.dumps(
            {
                "status": "intent_routed",
                "intent": "fallback_pipeline",
                "trigger_pipeline": True,
                "message": "Starting generation pipeline.",
            }
        )

    run = create_generation_run(
        session=session,
        run_in=GenerationRunCreate(
            project_id=project_id,
            prompt=_truncate_prompt_for_generation_run(routed_prompt),
        ),
    )

    async for event in run_pipeline_generator(session, project_id, run.id, routed_prompt):
        yield event


@router.post("/{project_id}")
async def generate_pipeline(
    project_id: uuid.UUID,
    prompt: str,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None,
):
    """Start the generation pipeline and stream progress via SSE."""

    return EventSourceResponse(
        run_interface_then_pipeline_generator(session, project_id, prompt)
    )


@router.post("/{project_id}/chat")
async def generate_pipeline_for_chat_ui(
    project_id: uuid.UUID,
    payload: ChatGenerateStreamRequest,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None,
):
    """
    UI-first chat generation stream.
    Emits normalized SSE events for the current ChatPage renderer (progress + docs + files).
    """
    return EventSourceResponse(
        run_interface_then_pipeline_ui_stream(session, project_id, payload)
    )


@router.post("/thread/{thread_id}/chat")
async def generate_pipeline_for_chat_thread(
    thread_id: str,
    payload: ChatGenerateStreamRequest,
    session: Session = Depends(get_db),
):
    """
    UI-facing chat generation endpoint keyed by chat thread ID instead of backend project ID.

    Backend resolves/creates a project internally and reuses it for subsequent runs in the same thread.
    """
    try:
        current_user = _get_or_create_chat_bridge_user(session)

        project_id = _resolve_or_create_project_for_thread(
            session=session,
            current_user=current_user,
            thread_id=thread_id,
            prompt=payload.prompt,
        )
    except OperationalError as exc:
        logger.error("DB unavailable while starting thread chat pipeline: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable. Please retry in a moment.",
        ) from exc
    return EventSourceResponse(
        run_interface_then_pipeline_ui_stream(session, project_id, payload, thread_id=thread_id)
    )
