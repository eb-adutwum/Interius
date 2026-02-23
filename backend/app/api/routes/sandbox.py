"""
Sandbox deployment endpoint.

Writes generated code files + dependencies to a shared Docker volume,
then triggers the sandbox-runner container to install deps and start uvicorn.
"""
import logging
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.api.deps import CurrentUser, get_db
from app.models import Project, ArtifactRecord, GenerationRun

logger = logging.getLogger(__name__)
router = APIRouter()

SANDBOX_ROOT = Path("/sandbox")


class SandboxStatus(BaseModel):
    status: str
    message: str
    swagger_url: str | None = None


def _get_latest_code(session: Session, project_id: uuid.UUID) -> dict | None:
    """Find the latest reviewer or implementer artifact for a project."""
    # Get the latest run for this project
    run = (
        session.query(GenerationRun)
        .filter(GenerationRun.project_id == project_id)
        .order_by(GenerationRun.created_at.desc())
        .first()
    )
    if not run:
        return None

    # Prefer the reviewer's final_code, fall back to implementer
    artifacts = (
        session.query(ArtifactRecord)
        .filter(ArtifactRecord.run_id == run.id)
        .all()
    )

    reviewer_artifact = None
    implementer_artifact = None
    for a in artifacts:
        if a.stage.startswith("reviewer_pass"):
            reviewer_artifact = a
        elif a.stage == "implementer":
            implementer_artifact = a

    if reviewer_artifact and reviewer_artifact.content.get("final_code"):
        return {
            "files": reviewer_artifact.content["final_code"],
            "dependencies": implementer_artifact.content.get("dependencies", []) if implementer_artifact else [],
        }
    elif implementer_artifact:
        return implementer_artifact.content
    return None


@router.post("/deploy/{project_id}", response_model=SandboxStatus)
def deploy_to_sandbox(
    project_id: uuid.UUID,
    session: Session = Depends(get_db),
    current_user: CurrentUser = None,
) -> Any:
    """Deploy generated code to the sandbox runner container."""

    # 1. Verify project ownership
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # 2. Get the latest generated code
    code_data = _get_latest_code(session, project_id)
    if not code_data or not code_data.get("files"):
        raise HTTPException(
            status_code=400,
            detail="No generated code found for this project. Run the pipeline first.",
        )

    files = code_data["files"]
    dependencies = code_data.get("dependencies", [])

    # 3. Write files to sandbox volume
    sandbox_dir = SANDBOX_ROOT / str(project_id)
    if sandbox_dir.exists():
        shutil.rmtree(sandbox_dir)
    sandbox_dir.mkdir(parents=True, exist_ok=True)

    for f in files:
        file_path = sandbox_dir / f["path"]
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Auto-patch Pydantic v1 'regex' kwarg to v2 'pattern' kwarg
        content = f["content"].replace("regex=", "pattern=")
        
        # Auto-patch common LLM mistake: get_db().bind
        content = content.replace("from .database import get_db", "from .database import get_db, engine")
        content = content.replace("bind=get_db().bind", "bind=engine")
        
        file_path.write_text(content, encoding="utf-8")
        logger.info(f"Wrote sandbox file: {file_path}")

    # 4. Write requirements.txt
    # Always ensure fastapi and uvicorn are present
    base_deps = {"fastapi", "uvicorn[standard]", "sqlmodel"}
    all_deps = base_deps | set(dependencies)
    reqs_path = sandbox_dir / "requirements.txt"
    reqs_path.write_text("\n".join(sorted(all_deps)), encoding="utf-8")

    # 5. Write a launcher script
    launcher = sandbox_dir / "start.sh"
    launcher.write_text(
        f"""#!/bin/bash
set -e
cd /sandbox/{project_id}
pip install -q -r requirements.txt 2>&1

# Kill previous uvicorn if it exists
if [ -f /sandbox/uvicorn.pid ]; then
    kill -9 $(cat /sandbox/uvicorn.pid) 2>/dev/null || true
    rm /sandbox/uvicorn.pid
fi
sleep 1

# Try to find the main app module
if [ -f "app/main.py" ]; then
    MODULE="app.main:app"
elif [ -f "main.py" ]; then
    MODULE="main:app"
else
    # Find any file that creates a FastAPI app
    MODULE=$(grep -rl "FastAPI()" . --include="*.py" | head -1 | sed 's|^./||;s|/|.|g;s|.py$||'):app
fi

# Start uvicorn in background and save its PID
uvicorn $MODULE --host 0.0.0.0 --port 9000 > /sandbox/uvicorn.log 2>&1 &
echo $! > /sandbox/uvicorn.pid
""",
        encoding="utf-8",
    )
    launcher.chmod(0o755)

    # 6. Execute the launcher via docker exec on the sandbox-runner container
    try:
        result = subprocess.run(
            [
                "docker", "exec", "-d",
                "craftlive-sandbox-runner-1",
                "bash", f"/sandbox/{project_id}/start.sh",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.error(f"Sandbox start failed: {result.stderr}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to start sandbox: {result.stderr}",
            )
    except FileNotFoundError:
        # Docker CLI not available — try writing a signal file instead
        logger.warning("docker CLI not found, writing signal file for sandbox runner")
        signal = sandbox_dir / ".deploy"
        signal.write_text("start", encoding="utf-8")

    return SandboxStatus(
        status="deployed",
        message=f"API deployed to sandbox. {len(files)} files written.",
        swagger_url="http://localhost:9000/docs",
    )


@router.get("/status", response_model=SandboxStatus)
def get_sandbox_status() -> Any:
    """Check if the sandbox runner is serving an API."""
    import urllib.request

    try:
        req = urllib.request.urlopen("http://sandbox-runner:9000/docs", timeout=3)
        return SandboxStatus(
            status="running",
            message="Sandbox API is live.",
            swagger_url="http://localhost:9000/docs",
        )
    except Exception:
        return SandboxStatus(
            status="stopped",
            message="Sandbox is not currently running.",
        )
