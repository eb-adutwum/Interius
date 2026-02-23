import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import CurrentUser, get_db
from app.crud import create_project
from app.models import GenerationRunWithArtifacts, Project, ProjectCreate, ProjectPublic

router = APIRouter()

@router.post("/", response_model=ProjectPublic)
def create_new_project(
    *,
    session: Session = Depends(get_db),
    current_user: CurrentUser,
    project_in: ProjectCreate
) -> Any:
    project = create_project(session=session, project_in=project_in, owner_id=current_user.id)
    return project

@router.get("/", response_model=list[ProjectPublic])
def read_projects(
    session: Session = Depends(get_db),
    current_user: CurrentUser = None
) -> Any:
    projects = session.exec(select(Project).where(Project.owner_id == current_user.id)).all()
    return projects

@router.get("/{id}", response_model=ProjectPublic)
def read_project(
    id: uuid.UUID,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None
) -> Any:
    project = session.get(Project, id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return project

@router.get("/{id}/runs", response_model=list[GenerationRunWithArtifacts])
def read_project_runs(
    id: uuid.UUID,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None
) -> Any:
    project = session.get(Project, id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return project.runs
