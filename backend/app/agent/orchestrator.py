import json
import logging
import uuid

from sqlmodel import Session

from app.agent.architecture_agent import ArchitectureAgent
from app.agent.artifact_store import store_code_bundle
from app.agent.artifacts import GeneratedCode, ProjectCharter, RepairContext, ReviewReport, SystemArchitecture
from app.agent.implementer_agent import ImplementerAgent
from app.agent.repair_agent import RepairAgent
from app.agent.requirements_agent import RequirementsAgent
from app.agent.reviewer_agent import ReviewerAgent
from app.crud import create_artifact_record, update_generation_run_status
from app.models import ArtifactRecordCreate

logger = logging.getLogger(__name__)


def _rollback_session_safely(session: Session) -> None:
    try:
        session.rollback()
    except Exception as exc:
        logger.warning("Session rollback failed: %s", exc)


def _update_run_status_safely(session: Session, run_id: uuid.UUID, status: str) -> None:
    try:
        update_generation_run_status(session=session, run_id=run_id, status=status)
    except Exception as exc:
        logger.warning("Failed to update generation run %s to %s: %s", run_id, status, exc)


def _compact_generated_code_for_db(
    *,
    run_id: uuid.UUID,
    stage: str,
    code: GeneratedCode,
) -> dict:
    bundle_ref = store_code_bundle(
        run_id=run_id,
        stage=stage,
        files=code.files,
        dependencies=code.dependencies,
    )
    return {
        "bundle_ref": bundle_ref,
        "files_count": len(code.files),
        "paths": [file.path for file in code.files],
        "dependencies": code.dependencies,
    }


def _compact_review_for_db(
    *,
    run_id: uuid.UUID,
    stage: str,
    review_artifact: dict,
    dependencies: list[str],
) -> dict:
    final_code = list(review_artifact.get("final_code") or [])
    compact_artifact = dict(review_artifact)
    if not final_code:
        return compact_artifact

    bundle_ref = store_code_bundle(
        run_id=run_id,
        stage=stage,
        files=final_code,
        dependencies=dependencies,
    )
    compact_artifact["bundle_ref"] = bundle_ref
    compact_artifact["final_code"] = []
    compact_artifact["final_code_files_count"] = len(final_code)
    compact_artifact["paths"] = [
        file.get("path")
        for file in final_code
        if isinstance(file, dict) and file.get("path")
    ]
    compact_artifact["dependencies"] = dependencies
    return compact_artifact

async def run_pipeline_generator(
    session: Session,
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    prompt: str,
    *,
    runtime_mode: str = "sandbox",
    start_stage: str = "requirements",
    charter_override: ProjectCharter | None = None,
    architecture_override: SystemArchitecture | None = None,
):
    """
    Generator function that runs the agents sequentially, saves artifacts to the DB,
    and yields SSE events for the frontend.
    """
    yield json.dumps({"status": "starting", "message": "Initializing pipeline..."})
    _update_run_status_safely(session=session, run_id=run_id, status="running")

    try:
        # 1. RAG Context (Temporarily disabled for model testing)
        # yield json.dumps({"status": "rag", "message": "Retrieving project context..."})
        # rag_context = get_rag_manager().query_context(str(project_id), prompt)
        combined_prompt = prompt
        # if rag_context:
        #     combined_prompt += f"\n\n{rag_context}"

        stage_mode = (start_stage or "requirements").strip().lower()

        charter: ProjectCharter | None = None
        architecture: SystemArchitecture | None = None

        if stage_mode == "requirements":
            # 2. Requirements Agent
            yield json.dumps({"status": "requirements", "message": "Analyzing requirements..."})
            req_agent = RequirementsAgent()
            charter = await req_agent.run(combined_prompt)

            create_artifact_record(
                session=session,
                artifact_in=ArtifactRecordCreate(
                    run_id=run_id,
                    stage="requirements",
                    content=charter.model_dump()
                )
            )
            yield json.dumps({"status": "requirements_done", "artifact": charter.model_dump()})

            # 3. Architecture Agent
            yield json.dumps({"status": "architecture", "message": "Designing system architecture..."})
            arch_agent = ArchitectureAgent()
            architecture = await arch_agent.run(charter)

            create_artifact_record(
                session=session,
                artifact_in=ArtifactRecordCreate(
                    run_id=run_id,
                    stage="architecture",
                    content=architecture.model_dump()
                )
            )
            yield json.dumps({"status": "architecture_done", "artifact": architecture.model_dump()})
        elif stage_mode == "implementer":
            if architecture_override is None:
                raise ValueError("architecture_override is required when starting from implementer")
            architecture = architecture_override
            charter = charter_override
            # Emit checkpoint completion events so UI can resume consistently in future integrations if needed.
            if charter is not None:
                yield json.dumps({"status": "requirements_done", "artifact": charter.model_dump()})
            yield json.dumps({"status": "architecture_done", "artifact": architecture.model_dump()})
        else:
            raise ValueError(f"Unsupported start_stage: {start_stage}")

        # 4. Implementer Agent
        yield json.dumps({"status": "implementer", "message": "Generating source code..."})
        imp_agent = ImplementerAgent()
        code = await imp_agent.run(architecture)

        # Save Artifact
        create_artifact_record(
            session=session,
            artifact_in=ArtifactRecordCreate(
                run_id=run_id,
                stage="implementer",
                content=_compact_generated_code_for_db(
                    run_id=run_id,
                    stage="implementer",
                    code=code,
                ),
            )
        )
        yield json.dumps({
            "status": "implementer_done",
            "files_count": len(code.files),
            "artifact": code.model_dump()
        })

        # 5. Review Loop (Perceive-Plan-Act cycle)
        MAX_REVIEW_ITERATIONS = 3
        REVIEW_TRUST_SCORE_THRESHOLD = 7  # Reuse reviewer security_score as the current trust threshold.
        rev_agent = ReviewerAgent()
        review_artifact_for_completion: dict = {
            "approved": True,
            "issues": [],
            "suggestions": [],
            "security_score": 7,
            "affected_files": [],
            "patch_requests": [],
            "final_code": [f.model_dump() for f in code.files],
        }

        try:
            for attempt in range(1, MAX_REVIEW_ITERATIONS + 1):
                yield json.dumps({
                    "status": "reviewer",
                    "message": "Reviewing generated code..."
                })

                review = await rev_agent.run(code)
                review_artifact_for_completion = review.model_dump()
                review_artifact_for_completion["final_code"] = [f.model_dump() for f in code.files]

                # Save the review artifact for this pass
                create_artifact_record(
                    session=session,
                    artifact_in=ArtifactRecordCreate(
                        run_id=run_id,
                        stage=f"reviewer_pass_{attempt}",
                        content=_compact_review_for_db(
                            run_id=run_id,
                            stage=f"reviewer_pass_{attempt}",
                            review_artifact=review_artifact_for_completion,
                            dependencies=code.dependencies,
                        ),
                    )
                )

                yield json.dumps({
                    "status": "review_pass",
                    "message": (
                        "Review pass accepted."
                        if bool(review.approved)
                        else "Review pass found blocking issues."
                    ),
                    "attempt": attempt,
                    "issues_count": len(review.issues or []),
                    "affected_files": list(review.affected_files or []),
                    "security_score": review.security_score,
                    "approved": bool(review.approved),
                    "meets_trust_threshold": (review.security_score or 0) >= REVIEW_TRUST_SCORE_THRESHOLD,
                })

                meets_trust_threshold = (review.security_score or 0) >= REVIEW_TRUST_SCORE_THRESHOLD
                review_accepted = bool(review.approved) and meets_trust_threshold

                if review_accepted:
                    logger.info(
                        "Code approved on review pass %s (score=%s, threshold=%s)",
                        attempt,
                        review.security_score,
                        REVIEW_TRUST_SCORE_THRESHOLD,
                    )
                    yield json.dumps({
                        "status": "reviewer_done",
                        "message": "Review completed.",
                        "artifact": review_artifact_for_completion,
                        "attempt": attempt,
                        "issues_count": len(review.issues or []),
                        "affected_files": list(review.affected_files or []),
                        "security_score": review.security_score,
                    })
                    break

                if review.approved and not meets_trust_threshold:
                    logger.info(
                        "Review pass %s approved code but score %s is below threshold %s; requesting targeted fixes.",
                        attempt,
                        review.security_score,
                        REVIEW_TRUST_SCORE_THRESHOLD,
                    )

                if review.final_code:
                    logger.info("Review pass %s returned reviewer rewrites; re-running review.", attempt)
                    code = GeneratedCode(files=review.final_code, dependencies=code.dependencies)
                    review_artifact_for_completion["final_code"] = [f.model_dump() for f in code.files]
                    yield json.dumps(
                        {
                            "status": "revision",
                            "message": "Reviewer applied fixes and is re-checking the updated code.",
                            "attempt": attempt,
                            "issues_count": len(review.issues),
                            "affected_files": list(review.affected_files or []),
                            "security_score": review.security_score,
                        }
                    )
                    continue

                issue_map: dict[str, list[str]] = {}
                for issue in review.issues or []:
                    path = (issue.file_path or "").strip()
                    if not path:
                        continue
                    desc = f"[{issue.severity}] {issue.description}"
                    issue_map.setdefault(path, []).append(desc)

                affected_from_review = [p for p in (review.affected_files or []) if isinstance(p, str) and p.strip()]
                affected_from_issues = [p for p in issue_map.keys() if p]
                targeted_paths = list(dict.fromkeys(affected_from_review + affected_from_issues))
                patch_requests = list(review.patch_requests or [])

                if not patch_requests and targeted_paths:
                    # Build minimal patch requests from issues/affected files so implementer can patch deterministically.
                    from app.agent.artifacts import FilePatchRequest  # local import to avoid circular import surprises
                    patch_requests = [
                        FilePatchRequest(
                            path=path,
                            reason="Reviewer reported issues in this file",
                            instructions=issue_map.get(path, []) or ["Fix the reviewer-reported issues while preserving existing behavior."],
                        )
                        for path in targeted_paths
                    ]

                # Code not approved - only retry if reviewer returned rewritten code or targeted patch requests.
                if not patch_requests:
                    logger.info(
                        "Review pass %s returned issues but no rewritten code; ending review loop without retry.",
                        attempt,
                    )
                    yield json.dumps({
                        "status": "reviewer_done",
                        "message": "Review completed.",
                        "artifact": review_artifact_for_completion,
                        "attempt": attempt,
                        "issues_count": len(review.issues or []),
                        "affected_files": list(review.affected_files or []),
                        "security_score": review.security_score,
                    })
                    break

                logger.info(
                    "Review pass %s: %s issues found across %s file(s); regenerating affected files.",
                    attempt,
                    len(review.issues),
                    len(patch_requests),
                )
                code = await imp_agent.patch_files(
                    architecture=architecture,
                    current_code=code,
                    patch_requests=patch_requests,
                    review_issue_descriptions_by_file=issue_map,
                )
                review_artifact_for_completion["final_code"] = [f.model_dump() for f in code.files]

                yield json.dumps({
                    "status": "revision",
                    "message": "Reviewer requested targeted fixes. Regenerating affected files and re-checking.",
                    "attempt": attempt,
                    "issues_count": len(review.issues),
                    "affected_files": [getattr(req, "path", None) for req in patch_requests if getattr(req, "path", None)],
                    "security_score": review.security_score,
                })
            else:
                # Exhausted all retries without approval
                logger.warning(f"Code not approved after {MAX_REVIEW_ITERATIONS} review passes")
                yield json.dumps({
                    "status": "reviewer_done",
                    "message": "Review completed.",
                    "artifact": review_artifact_for_completion,
                    "attempt": MAX_REVIEW_ITERATIONS,
                    "issues_count": len(review_artifact_for_completion.get("issues") or []),
                    "affected_files": list(review_artifact_for_completion.get("affected_files") or []),
                    "security_score": review_artifact_for_completion.get("security_score"),
                })
        except Exception as review_error:
            logger.warning("Reviewer stage failed; continuing with implementer output: %s", review_error)
            review_artifact_for_completion = {
                "approved": False,
                "issues": [],
                "suggestions": [f"Reviewer failed: {review_error}. Returning implementer output."],
                "security_score": 5,
                "final_code": [f.model_dump() for f in code.files],
            }
            yield json.dumps({
                "status": "reviewer_done",
                "message": "Reviewer failed; returning generated code without review approval.",
                "artifact": review_artifact_for_completion,
                "attempt": MAX_REVIEW_ITERATIONS,
                "issues_count": 0,
                "affected_files": [],
                "security_score": review_artifact_for_completion.get("security_score"),
            })

        normalized_runtime_mode = (runtime_mode or "sandbox").strip().lower()
        if normalized_runtime_mode == "local_cli":
            review_artifact_for_completion["runtime_mode"] = "local_cli"
            review_artifact_for_completion["approved"] = True
            review_artifact_for_completion.setdefault("suggestions", []).append(
                "Skipped backend Docker sandbox repair for CLI local runtime mode. The CLI will validate startup locally."
            )
            yield json.dumps({
                "status": "completed",
                "message": "Review completed. Skipping backend sandbox repair for CLI local runtime mode.",
                "artifact": review_artifact_for_completion,
            })
            _update_run_status_safely(session=session, run_id=run_id, status="completed")
            return

        # 6. Runtime repair loop
        MAX_REPAIR_ITERATIONS = 3
        repair_agent = RepairAgent(max_iterations=MAX_REPAIR_ITERATIONS)
        repair_context = RepairContext(
            architecture=architecture,
            code=code,
            review_report=ReviewReport.model_validate(review_artifact_for_completion),
            project_id=str(project_id),
        )
        yield json.dumps({
            "status": "repairer",
            "message": "Running runtime repair checks on the generated API..."
        })

        try:
            repair_result = await repair_agent.run(repair_context)
            code = GeneratedCode(files=repair_result.final_code, dependencies=code.dependencies)
            repair_artifact_for_completion = repair_result.model_dump()

            for attempt in range(1, repair_result.attempts + 1):
                changed_paths = list(repair_result.affected_files or [])
                yield json.dumps({
                    "status": "repair_revision",
                    "message": "Repair is applying sandbox-driven fixes from container logs and endpoint smoke checks.",
                    "attempt": attempt,
                    "issues_count": len(repair_result.failures or []),
                    "affected_files": changed_paths,
                })

                create_artifact_record(
                    session=session,
                    artifact_in=ArtifactRecordCreate(
                        run_id=run_id,
                        stage=f"repairer_pass_{attempt}",
                        content=_compact_review_for_db(
                            run_id=run_id,
                            stage=f"repairer_pass_{attempt}",
                            review_artifact=repair_artifact_for_completion,
                            dependencies=code.dependencies,
                        ),
                    )
                )
        except Exception as repair_error:
            logger.warning("Repair stage failed; continuing with latest generated code: %s", repair_error, exc_info=True)
            repair_artifact_for_completion = {
                "passed": False,
                "repaired": False,
                "attempts": 0,
                "affected_files": [],
                "failures": [],
                "warnings": [f"Repair stage failed: {repair_error}"],
                "patch_requests": [],
                "summary": f"Repair stage failed: {repair_error}. Returning latest generated code.",
                "final_code": [file.model_dump() for file in code.files],
            }
        create_artifact_record(
            session=session,
            artifact_in=ArtifactRecordCreate(
                run_id=run_id,
                stage="repairer_final",
                content=_compact_review_for_db(
                    run_id=run_id,
                    stage="repairer_final",
                    review_artifact=repair_artifact_for_completion,
                    dependencies=code.dependencies,
                ),
            )
        )

        review_artifact_for_completion["final_code"] = [file.model_dump() for file in code.files]
        review_artifact_for_completion["repair"] = repair_artifact_for_completion
        review_artifact_for_completion["approved"] = bool(repair_artifact_for_completion.get("passed"))
        review_artifact_for_completion["artifacts_released"] = bool(review_artifact_for_completion.get("final_code"))
        if review_artifact_for_completion["repair"]["summary"] not in (review_artifact_for_completion.get("suggestions") or []):
            review_artifact_for_completion.setdefault("suggestions", []).append(review_artifact_for_completion["repair"]["summary"])
        if (
            review_artifact_for_completion["approved"]
            and not bool(repair_artifact_for_completion.get("fully_validated"))
        ):
            review_artifact_for_completion.setdefault("suggestions", []).append(
                "The generated API is deployable and artifacts are released, but some endpoint smoke checks still reported warnings."
            )

        yield json.dumps({
            "status": "repairer_done",
            "message": review_artifact_for_completion["repair"]["summary"],
            "artifact": repair_artifact_for_completion,
            "attempt": repair_artifact_for_completion.get("attempts", 0),
            "issues_count": len(repair_artifact_for_completion.get("failures") or []),
            "affected_files": list(repair_artifact_for_completion.get("affected_files") or []),
        })

        if not review_artifact_for_completion["approved"]:
            review_artifact_for_completion.setdefault("suggestions", []).append(
                "Artifacts are being returned even though runtime validation still reports blocking issues. Review the generated files before deployment."
            )
            yield json.dumps({
                "status": "completed",
                "message": "Pipeline finished with generated artifacts, but runtime validation still reported blocking issues.",
                "artifact": review_artifact_for_completion,
            })
            _update_run_status_safely(session=session, run_id=run_id, status="completed")
            return

        yield json.dumps({
            "status": "completed",
            "message": (
                "Pipeline finished successfully!"
                if bool(repair_artifact_for_completion.get("fully_validated"))
                else "Pipeline finished with deployable artifacts and runtime warnings."
            ),
            "artifact": review_artifact_for_completion,
        })
        _update_run_status_safely(session=session, run_id=run_id, status="completed")

    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        _rollback_session_safely(session)
        yield json.dumps({"status": "error", "message": str(e)})
        _update_run_status_safely(session=session, run_id=run_id, status="failed")
