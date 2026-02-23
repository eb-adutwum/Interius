import json
import logging
import uuid

from sqlmodel import Session

from app.agent.architecture_agent import ArchitectureAgent
from app.agent.artifacts import GeneratedCode
from app.agent.implementer_agent import ImplementerAgent
from app.agent.rag import get_rag_manager
from app.agent.requirements_agent import RequirementsAgent
from app.agent.reviewer_agent import ReviewerAgent
from app.crud import create_artifact_record, update_generation_run_status
from app.models import ArtifactRecordCreate

logger = logging.getLogger(__name__)

async def run_pipeline_generator(session: Session, project_id: uuid.UUID, run_id: uuid.UUID, prompt: str):
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

        # 2. Requirements Agent
        yield json.dumps({"status": "requirements", "message": "Analyzing requirements..."})
        req_agent = RequirementsAgent()
        charter = await req_agent.run(combined_prompt)

        # Save Artifact
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

        # Save Artifact
        create_artifact_record(
            session=session,
            artifact_in=ArtifactRecordCreate(
                run_id=run_id,
                stage="architecture",
                content=architecture.model_dump()
            )
        )
        yield json.dumps({"status": "architecture_done", "artifact": architecture.model_dump()})

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
        yield json.dumps({"status": "implementer_done", "files_count": len(code.files)})

        # 5. Review Loop (Perceive-Plan-Act cycle)
        MAX_REVIEW_ITERATIONS = 3
        rev_agent = ReviewerAgent()

        for attempt in range(1, MAX_REVIEW_ITERATIONS + 1):
            yield json.dumps({
                "status": "reviewer",
                "message": f"Review pass {attempt}/{MAX_REVIEW_ITERATIONS} — checking code quality and security..."
            })

            review = await rev_agent.run(code)

            # Save the review artifact for this pass
            create_artifact_record(
                session=session,
                artifact_in=ArtifactRecordCreate(
                    run_id=run_id,
                    stage=f"reviewer_pass_{attempt}",
                    content=review.model_dump()
                )
            )

            if review.approved:
                logger.info(f"Code approved on review pass {attempt}")
                yield json.dumps({
                    "status": "reviewer_done",
                    "message": f"Code approved on pass {attempt}!",
                    "artifact": review.model_dump()
                })
                break

            # Code not approved — feed the reviewer's fixed code back for another pass
            logger.info(f"Review pass {attempt}: {len(review.issues)} issues found, retrying...")
            code = GeneratedCode(files=review.final_code, dependencies=code.dependencies)

            yield json.dumps({
                "status": "revision",
                "message": f"Pass {attempt}: {len(review.issues)} issues found — applying fixes and re-reviewing...",
                "attempt": attempt,
                "issues_count": len(review.issues)
            })
        else:
            # Exhausted all retries without approval
            logger.warning(f"Code not approved after {MAX_REVIEW_ITERATIONS} review passes")
            yield json.dumps({
                "status": "reviewer_done",
                "message": f"Review completed after {MAX_REVIEW_ITERATIONS} passes (some issues may remain).",
                "artifact": review.model_dump()
            })

        yield json.dumps({"status": "completed", "message": "Pipeline finished successfully!", "artifact": review.model_dump()})
        update_generation_run_status(session=session, run_id=run_id, status="completed")

    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        yield json.dumps({"status": "error", "message": str(e)})
        update_generation_run_status(session=session, run_id=run_id, status="failed")
