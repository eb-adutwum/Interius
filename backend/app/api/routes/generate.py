import json
import uuid
import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from sse_starlette.sse import EventSourceResponse

from app.api.deps import CurrentUser, get_db
from app.crud import create_generation_run
from app.models import GenerationRunCreate
from app.agent.orchestrator import run_pipeline_generator

router = APIRouter()

@router.post("/{project_id}")
async def generate_pipeline(
    project_id: uuid.UUID,
    prompt: str,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None
):
    """Start the generation pipeline and stream progress via SSE."""
    
    # Run the pipeline and store record
    run = create_generation_run(
        session=session, 
        run_in=GenerationRunCreate(project_id=project_id, prompt=prompt)
    )
    
    # Return SSE generator response
    return EventSourceResponse(run_pipeline_generator(session, project_id, run.id, prompt))
