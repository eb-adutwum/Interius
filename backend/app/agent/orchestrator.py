import json
import logging
import uuid

from sqlmodel import Session

from app.agent.architecture_agent import ArchitectureAgent
from app.agent.artifacts import GeneratedCode, ProjectCharter, SystemArchitecture
from app.agent.implementer_agent import ImplementerAgent
from app.agent.rag import get_rag_manager
from app.agent.requirements_agent import RequirementsAgent
from app.agent.reviewer_agent import ReviewerAgent
from app.crud import create_artifact_record, update_generation_run_status
from app.models import ArtifactRecordCreate

logger = logging.getLogger(__name__)

async def run_pipeline_generator(
    session: Session,
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    prompt: str,
    *,
    start_stage: str = "requirements",
    charter_override: ProjectCharter | None = None,
    architecture_override: SystemArchitecture | None = None,
):
    """
    Generator function that runs the agents sequentially, saves artifacts to the DB,
    and yields SSE events for the frontend.
    """
    yield json.dumps({"status": "starting", "message": "Initializing pipeline..."})
    update_generation_run_status(session=session, run_id=run_id, status="running")

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
                content=code.model_dump()
            )
        )
        yield json.dumps({
            "status": "implementer_done",
            "files_count": len(code.files),
            "artifact": code.model_dump()
        })

        # 5. Review Loop (Perceive-Plan-Act cycle)
        MAX_REVIEW_ITERATIONS = 5
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
                    "message": f"Review pass {attempt}/{MAX_REVIEW_ITERATIONS} - checking code quality and security..."
                })

                review = await rev_agent.run(code)
                review_artifact_for_completion = review.model_dump()

                # Save the review artifact for this pass
                create_artifact_record(
                    session=session,
                    artifact_in=ArtifactRecordCreate(
                        run_id=run_id,
                        stage=f"reviewer_pass_{attempt}",
                        content=review_artifact_for_completion
                    )
                )

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
                        "message": (
                            f"Code approved on pass {attempt} "
                            f"(trust score {review.security_score}/{10})."
                        ),
                        "artifact": review_artifact_for_completion
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
                    yield json.dumps({
                        "status": "revision",
                    "message": (
                        f"Pass {attempt}: reviewer provided code fixes; "
                        "re-reviewing updated files..."
                    ),
                    "attempt": attempt,
                    "issues_count": len(review.issues)
                })
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
                        "message": f"Review found {len(review.issues)} issue(s); returning generated code without reviewer rewrites.",
                        "artifact": review_artifact_for_completion
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

                yield json.dumps({
                    "status": "revision",
                    "message": (
                        f"Pass {attempt}: {len(review.issues)} reviewer issue(s) "
                        f"(trust score {review.security_score}/{10}) - regenerating "
                        "affected files and re-reviewing..."
                    ),
                    "attempt": attempt,
                    "issues_count": len(review.issues),
                    "affected_files": [getattr(req, "path", None) for req in patch_requests if getattr(req, "path", None)],
                })
            else:
                # Exhausted all retries without approval
                logger.warning(f"Code not approved after {MAX_REVIEW_ITERATIONS} review passes")
                yield json.dumps({
                    "status": "reviewer_done",
                    "message": f"Review completed after {MAX_REVIEW_ITERATIONS} passes (some issues may remain).",
                    "artifact": review_artifact_for_completion
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
                "artifact": review_artifact_for_completion
            })

        yield json.dumps({
            "status": "completed",
            "message": "Pipeline finished successfully!",
            "artifact": review_artifact_for_completion,
        })
        update_generation_run_status(session=session, run_id=run_id, status="completed")

    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        yield json.dumps({"status": "error", "message": str(e)})
        update_generation_run_status(session=session, run_id=run_id, status="failed")
