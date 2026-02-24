import json
import logging
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session
from sse_starlette.sse import EventSourceResponse

from app.agent.interface import InterfaceAgent, InterfaceDecision
from app.agent.orchestrator import run_pipeline_generator
from app.api.deps import CurrentUser, get_db
from app.crud import create_generation_run
from app.models import GenerationRunCreate

router = APIRouter()
logger = logging.getLogger(__name__)


class InterfacePromptRequest(BaseModel):
    prompt: str


@router.post("/interface", response_model=InterfaceDecision)
async def route_interface_prompt(payload: InterfacePromptRequest) -> InterfaceDecision:
    """
    Intent-only endpoint for the frontend chat UI.
    Returns a normal conversational reply or a pipeline-routing decision.
    """
    try:
        return await InterfaceAgent().run(payload.prompt)
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
        run_in=GenerationRunCreate(project_id=project_id, prompt=routed_prompt),
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
