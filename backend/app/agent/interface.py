import re
from typing import Literal

from pydantic import BaseModel, Field
from app.agent.base import BaseAgent
from app.core.config import settings

INTERFACE_SYSTEM_PROMPT = """
You are Interius, the chat interface and intent router for an API/backend code generation assistant.

Your job is to decide whether the user's latest message should trigger the full generation
pipeline or should be handled as normal conversation.

Choose `should_trigger_pipeline=true` only when the user is clearly asking to build/generate/modify
software artifacts (APIs, code, schemas, endpoints, architecture, tests, deployment configs, etc.)
and the request is actionable for the pipeline.

Choose `should_trigger_pipeline=false` for:
- greetings, thanks, acknowledgements
- questions asking for clarification or context only
- conversational responses that do not ask for generation work
- vague prompts that need a follow-up question before generation

Return a concise assistant reply:
- If no pipeline: directly answer or ask a clarifying question.
- If pipeline: acknowledge and say Interius is starting generation.
- Always speak as Interius (use the name "Interius" in the assistant reply).
- Do not prefix replies with a speaker label like "Interius:".
- If an attachment summary indicates `text=no`, Interius only knows the file metadata (not its contents yet).
  Be honest and ask the user to re-upload or paste the relevant portion if content is needed.
- If a build is triggered and any attachment summary has `text=yes` with an excerpt, mention one concrete detail
  from the attached context (briefly) so the acknowledgment shows Interius understood the file context.

If `should_trigger_pipeline=true`, provide `pipeline_prompt` as a cleaned version of the request suitable
for downstream agents. If false, set `pipeline_prompt` to null.

Also return `action_type`:
- `chat` for non-pipeline replies
- `build_new` for a fresh build request
- `continue_from_architecture` when the user is asking to keep the existing architecture and regenerate/fix code only
- `artifact_retrieval` when the user is asking to re-open/re-download existing generated artifacts (if detectable)

If `action_type=continue_from_architecture`, include `execution_plan` with:
{
  "mode": "resume_from_architecture",
  "skip_stages": ["requirements", "architecture"]
}

Use recent conversation context when provided to interpret follow-up requests, pronouns, and references
to previously generated files/artifacts.
""".strip()


class InterfaceContextMessage(BaseModel):
    role: Literal["user", "assistant", "agent"]
    content: str = Field(..., min_length=1)


class InterfaceAttachmentSummary(BaseModel):
    filename: str = Field(..., min_length=1)
    mime_type: str | None = None
    size_bytes: int | None = None
    text_excerpt: str | None = None
    has_text_content: bool = False


class InterfaceDecision(BaseModel):
    intent: Literal["pipeline_request", "context_question", "social", "clarification"]
    should_trigger_pipeline: bool
    action_type: Literal[
        "chat",
        "build_new",
        "continue_from_architecture",
        "artifact_retrieval",
    ] = "chat"
    assistant_reply: str = Field(
        ...,
        description="Short message to show the user before/without pipeline execution.",
    )
    pipeline_prompt: str | None = Field(
        default=None,
        description="Normalized prompt to pass to the orchestrator when pipeline should run.",
    )
    execution_plan: dict | None = Field(
        default=None,
        description="Optional execution plan hints such as stage skip/resume instructions.",
    )


class InterfaceAgent(BaseAgent[str, InterfaceDecision]):
    """Routes user messages to either chat response or the generation pipeline."""

    def __init__(self, model_name: str | None = None):
        super().__init__(
            model_name=model_name or settings.MODEL_INTERFACE,
            base_url=settings.INTERFACE_LLM_BASE_URL or None,
            api_key=settings.INTERFACE_LLM_API_KEY or None,
        )

    async def run(
        self,
        input_data: str,
        recent_messages: list[InterfaceContextMessage] | None = None,
        attachment_summaries: list[InterfaceAttachmentSummary] | None = None,
    ) -> InterfaceDecision:
        text = (input_data or "").strip()

        retrieval_heuristic = self._quick_artifact_retrieval_request(text, recent_messages)
        if retrieval_heuristic:
            return retrieval_heuristic

        code_question_heuristic = self._quick_thread_code_question(text, recent_messages)
        if code_question_heuristic:
            return code_question_heuristic

        heuristic = self._quick_non_pipeline(text)
        if heuristic:
            return heuristic

        resume_heuristic = self._quick_resume_from_architecture(text, recent_messages)
        if resume_heuristic:
            return resume_heuristic

        attachment_clarifier = self._quick_attachment_metadata_only_response(
            text, attachment_summaries
        )
        if attachment_clarifier:
            return attachment_clarifier

        if not text and attachment_summaries:
            count = len(attachment_summaries)
            noun = "file" if count == 1 else "files"
            return InterfaceDecision(
                intent="context_question",
                should_trigger_pipeline=False,
                action_type="chat",
                assistant_reply=f"I've noted {count} attached {noun} as thread context. Tell me what you want Interius to build when you're ready.",
                pipeline_prompt=None,
            )

        if not text:
            return InterfaceDecision(
                intent="clarification",
                should_trigger_pipeline=False,
                action_type="chat",
                assistant_reply="Tell me what you want to build or ask a question, and I can help from there.",
                pipeline_prompt=None,
            )

        decision = await self.llm.generate_structured(
            system_prompt=INTERFACE_SYSTEM_PROMPT,
            user_prompt=self._build_user_prompt(text, recent_messages, attachment_summaries),
            response_schema=InterfaceDecision,
        )
        return self._normalize_decision(text, decision, attachment_summaries)

    @staticmethod
    def _build_user_prompt(
        latest_prompt: str,
        recent_messages: list[InterfaceContextMessage] | None,
        attachment_summaries: list[InterfaceAttachmentSummary] | None,
    ) -> str:
        sections: list[str] = []

        trimmed_msgs: list[InterfaceContextMessage] = []
        for msg in (recent_messages or [])[-10:]:
            content = (msg.content or "").strip()
            if not content:
                continue
            trimmed_msgs.append(msg.model_copy(update={"content": content}))

        # Avoid duplicating the latest prompt if the frontend already included it in context.
        if (
            trimmed_msgs
            and trimmed_msgs[-1].role == "user"
            and trimmed_msgs[-1].content == latest_prompt.strip()
        ):
            trimmed_msgs = trimmed_msgs[:-1]

        if trimmed_msgs:
            context_lines = "\n".join(
                f"- {msg.role}: {msg.content}" for msg in trimmed_msgs
            )
            sections.append(
                "Recent conversation context (most recent last):\n"
                f"{context_lines}"
            )

        trimmed_files = (attachment_summaries or [])[-8:]
        if trimmed_files:
            file_lines = []
            for file in trimmed_files:
                parts = [file.filename]
                if file.mime_type:
                    parts.append(file.mime_type)
                if file.size_bytes is not None:
                    parts.append(f"{file.size_bytes} bytes")
                parts.append("text=yes" if file.has_text_content else "text=no")
                line = " | ".join(parts)
                if file.text_excerpt:
                    line += f"\n  excerpt: {file.text_excerpt}"
                file_lines.append(f"- {line}")
            sections.append(
                "Thread attachment summaries (for context only; not full file contents):\n"
                + "\n".join(file_lines)
            )

        sections.append("Latest user message:\n" + latest_prompt)
        return "\n\n".join(sections)

    @staticmethod
    def _normalize_decision(
        original_prompt: str,
        decision: InterfaceDecision,
        attachment_summaries: list[InterfaceAttachmentSummary] | None = None,
    ) -> InterfaceDecision:
        assistant_reply = (decision.assistant_reply or "").strip()
        assistant_reply = re.sub(r"^\s*Interius:\s*", "", assistant_reply, flags=re.IGNORECASE)

        if decision.should_trigger_pipeline:
            pipeline_prompt = (decision.pipeline_prompt or "").strip() or original_prompt.strip()
            assistant_reply = InterfaceAgent._enrich_build_ack_with_attachment_context(
                assistant_reply, attachment_summaries
            )
            action_type = decision.action_type
            execution_plan = decision.execution_plan if isinstance(decision.execution_plan, dict) else None
            if action_type not in {"build_new", "continue_from_architecture", "artifact_retrieval"}:
                action_type = "build_new"
            if action_type == "continue_from_architecture" and not execution_plan:
                execution_plan = {
                    "mode": "resume_from_architecture",
                    "skip_stages": ["requirements", "architecture"],
                }
            return decision.model_copy(
                update={
                    "intent": "pipeline_request",
                    "action_type": action_type,
                    "assistant_reply": assistant_reply or "Interius is starting generation for your request.",
                    "pipeline_prompt": pipeline_prompt,
                    "execution_plan": execution_plan,
                }
            )

        preserved_execution_plan = (
            decision.execution_plan
            if decision.action_type == "artifact_retrieval" and isinstance(decision.execution_plan, dict)
            else None
        )
        return decision.model_copy(
            update={
                "action_type": "artifact_retrieval" if decision.action_type == "artifact_retrieval" else "chat",
                "assistant_reply": assistant_reply or "Interius is ready to help.",
                "pipeline_prompt": None,
                "execution_plan": preserved_execution_plan,
            }
        )

    @staticmethod
    def _enrich_build_ack_with_attachment_context(
        assistant_reply: str,
        attachment_summaries: list[InterfaceAttachmentSummary] | None,
    ) -> str:
        reply = (assistant_reply or "").strip()
        file_with_text = next(
            (
                f for f in (attachment_summaries or [])
                if f.has_text_content and (f.text_excerpt or "").strip()
            ),
            None,
        )
        if not file_with_text:
            return reply or "Interius is starting generation for your request."

        excerpt = re.sub(r"\s+", " ", (file_with_text.text_excerpt or "")).strip()
        excerpt = excerpt[:140].rstrip(" ,;:-")
        if not excerpt:
            return reply or "Interius is starting generation for your request."

        evidence_line = (
            f'I can see context in `{file_with_text.filename}` (for example: "{excerpt}").'
        )
        if not reply:
            return "Interius is starting generation for your request. " + evidence_line

        if evidence_line.lower() in reply.lower():
            return reply

        # Avoid repetitive over-long acknowledgements.
        if len(reply) > 260:
            return reply

        return f"{reply.rstrip()} {evidence_line}"

    @staticmethod
    def looks_like_thread_code_question(
        text: str,
        recent_messages: list[InterfaceContextMessage] | None = None,
    ) -> bool:
        normalized = re.sub(r"\s+", " ", (text or "").lower()).strip()
        if not normalized:
            return False

        has_prior_agent_context = any((m.role in {"assistant", "agent"}) for m in (recent_messages or []))
        if not has_prior_agent_context:
            return False

        explanation_signals = [
            "what does",
            "what is",
            "how does",
            "how is",
            "where is",
            "which file",
            "which route",
            "which endpoint",
            "why does",
            "why is",
            "explain",
            "help me understand",
            "walk me through",
            "show me where",
            "tell me where",
        ]
        code_reference_signals = [
            "file",
            "code",
            "endpoint",
            "route",
            "auth",
            "authentication",
            "middleware",
            "model",
            "schema",
            "service",
            "controller",
            "handler",
            "database",
            "query",
            "api",
            "function",
            "class",
            "module",
            "generated",
            ".py",
            "/",
        ]
        pipeline_change_signals = [
            "build ",
            "generate ",
            "create ",
            "add ",
            "implement ",
            "modify ",
            "update ",
            "change ",
            "fix ",
            "patch ",
            "remove ",
            "delete ",
        ]

        mentions_code = any(token in normalized for token in code_reference_signals)
        asks_question = normalized.endswith("?") or any(token in normalized for token in explanation_signals)
        asks_for_change = any(token in normalized for token in pipeline_change_signals)

        return mentions_code and asks_question and not asks_for_change

    @classmethod
    def _quick_thread_code_question(
        cls,
        text: str,
        recent_messages: list[InterfaceContextMessage] | None,
    ) -> InterfaceDecision | None:
        if not cls.looks_like_thread_code_question(text, recent_messages):
            return None

        return InterfaceDecision(
            intent="context_question",
            should_trigger_pipeline=False,
            action_type="chat",
            assistant_reply="Interius is reviewing the generated files in this thread so I can answer your code question.",
            pipeline_prompt=None,
        )

    @staticmethod
    def _quick_non_pipeline(text: str) -> InterfaceDecision | None:
        if not text:
            return None

        normalized = re.sub(r"\s+", " ", text.lower()).strip()
        token_count = len(normalized.split())

        gratitude_tokens = {
            "thanks",
            "thank you",
            "thx",
            "ty",
            "appreciate it",
            "awesome thanks",
            "great thanks",
        }
        greeting_tokens = {
            "hi",
            "hello",
            "hey",
            "yo",
            "good morning",
            "good afternoon",
            "good evening",
            "good day",
        }

        if (
            "who are you" in normalized
            or "what do you do" in normalized
            or ("who are you" in normalized and "what" in normalized)
        ):
            return InterfaceDecision(
                intent="context_question",
                should_trigger_pipeline=False,
                action_type="chat",
                assistant_reply=(
                    "I'm Interius. I can answer questions directly, help clarify requirements, "
                    "and start the build pipeline when you want APIs, code, schemas, configs, or related backend artifacts."
                ),
                pipeline_prompt=None,
            )

        if normalized in gratitude_tokens or normalized.rstrip("!.") in gratitude_tokens:
            return InterfaceDecision(
                intent="social",
                should_trigger_pipeline=False,
                action_type="chat",
                assistant_reply="You're welcome. If you want, send the next feature or bug fix request and Interius will route it correctly.",
                pipeline_prompt=None,
            )

        if token_count <= 4 and normalized.rstrip("!.?") in greeting_tokens:
            return InterfaceDecision(
                intent="social",
                should_trigger_pipeline=False,
                action_type="chat",
                assistant_reply="Hi. Tell me what you need help with, and I can answer directly or start the build pipeline if you want me to generate something.",
                pipeline_prompt=None,
            )

        return None

    @staticmethod
    def _quick_artifact_retrieval_request(
        text: str,
        recent_messages: list[InterfaceContextMessage] | None,
    ) -> InterfaceDecision | None:
        if not text:
            return None
        normalized = re.sub(r"\s+", " ", text.lower()).strip()
        retrieval_signals = [
            "send the files again",
            "send the file again",
            "give me the files again",
            "give me the file again",
            "redownload",
            "re-download",
            "download again",
            "show the architecture again",
            "show me the architecture again",
            "show the requirements again",
            "show me the requirements again",
            "open the diagram again",
            "retrieve the files",
            "retrieve the generated files",
        ]
        if not any(sig in normalized for sig in retrieval_signals):
            return None

        has_prior_generation_context = any((m.role == "agent") for m in (recent_messages or []))
        if not has_prior_generation_context:
            return None

        retrieval_target = "all"
        if any(sig in normalized for sig in ["architecture", "diagram", "mmd"]):
            retrieval_target = "architecture"
        elif any(sig in normalized for sig in ["requirement", "requirements", "spec"]):
            retrieval_target = "requirements"
        elif any(sig in normalized for sig in ["code", "files", "file", "download", "redownload", "re-download"]):
            retrieval_target = "code_bundle"

        if retrieval_target == "architecture":
            reply = "Interius will retrieve the latest architecture artifacts from this thread so you can review them again."
        elif retrieval_target == "requirements":
            reply = "Interius will retrieve the latest requirements artifact from this thread."
        elif retrieval_target == "code_bundle":
            reply = "Interius will retrieve the latest generated code files from this thread so you can open or download them again."
        else:
            reply = "Interius will retrieve the latest generated artifacts from this thread so you can review or download them again."

        return InterfaceDecision(
            intent="context_question",
            should_trigger_pipeline=False,
            action_type="artifact_retrieval",
            assistant_reply=reply,
            pipeline_prompt=None,
            execution_plan={
                "mode": "artifact_retrieval",
                "target": retrieval_target,
            },
        )

    @staticmethod
    def _quick_attachment_metadata_only_response(
        text: str,
        attachment_summaries: list[InterfaceAttachmentSummary] | None,
    ) -> InterfaceDecision | None:
        if not text or not attachment_summaries:
            return None

        normalized = re.sub(r"\s+", " ", text.lower()).strip()
        mentions_attachment = any(
            token in normalized
            for token in ("attach", "attachment", "document", "pdf", "file", "there", "it")
        )
        asks_for_contents = any(
            token in normalized
            for token in ("read", "see", "what is in", "what's in", "use it", "use that", "summarize", "extract")
        )

        if not (mentions_attachment and asks_for_contents):
            return None

        if any(file.has_text_content for file in attachment_summaries):
            return None

        latest = attachment_summaries[-1]
        file_label = latest.filename if latest.filename else "the previously attached file"
        return InterfaceDecision(
            intent="clarification",
            should_trigger_pipeline=False,
            action_type="chat",
            assistant_reply=(
                f"I can see metadata for `{file_label}`, but I don't currently have its contents in this session. "
                "Please re-upload it (or paste the relevant section) if you want Interius to use it."
            ),
            pipeline_prompt=None,
        )

    @staticmethod
    def _quick_resume_from_architecture(
        text: str,
        recent_messages: list[InterfaceContextMessage] | None,
    ) -> InterfaceDecision | None:
        if not text:
            return None
        normalized = re.sub(r"\s+", " ", text.lower()).strip()
        resume_signals = [
            "use the same architecture",
            "continue from the architecture",
            "continue to code",
            "skip requirements",
            "skip architecture",
            "regenerate the code only",
            "fix the generated code",
            "patch the generated code",
            "update the generated code",
        ]
        if not any(sig in normalized for sig in resume_signals):
            return None

        has_prior_agent_context = any((m.role in {"assistant", "agent"}) for m in (recent_messages or []))
        if not has_prior_agent_context:
            return None

        return InterfaceDecision(
            intent="pipeline_request",
            should_trigger_pipeline=True,
            action_type="continue_from_architecture",
            assistant_reply="Interius will continue from the existing architecture and regenerate only the code/review stages.",
            pipeline_prompt=text.strip(),
            execution_plan={
                "mode": "resume_from_architecture",
                "skip_stages": ["requirements", "architecture"],
            },
        )
