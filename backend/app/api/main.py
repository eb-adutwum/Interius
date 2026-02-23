from fastapi import APIRouter

from app.api.routes import documents, login, private, users, utils, projects, generate, sandbox
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router, tags=["login"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(utils.router, tags=["utils"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(generate.router, prefix="/generate", tags=["generate"])
api_router.include_router(sandbox.router, prefix="/sandbox", tags=["sandbox"])

if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router, prefix="/private", tags=["private"])
