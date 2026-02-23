import uuid
from typing import Any

from sqlmodel import Session, select

from app.core.security import get_password_hash, verify_password
from app.models import User, UserCreate, UserUpdate


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


from app.models import Document, DocumentCreate

def create_document(*, session: Session, document_in: DocumentCreate) -> Document:
    db_document = Document.model_validate(document_in)
    session.add(db_document)
    session.commit()
    session.refresh(db_document)
    return db_document

def get_project_documents(session: Session, project_id: str) -> list[Document]:
    statement = select(Document).where(Document.project_id == project_id)
    return list(session.exec(statement).all())


from app.models import Project, ProjectCreate, GenerationRun, GenerationRunCreate, ArtifactRecord, ArtifactRecordCreate

def create_project(*, session: Session, project_in: ProjectCreate, owner_id: uuid.UUID) -> Project:
    db_project = Project.model_validate(project_in, update={"owner_id": owner_id})
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project

def create_generation_run(*, session: Session, run_in: GenerationRunCreate) -> GenerationRun:
    db_run = GenerationRun.model_validate(run_in)
    session.add(db_run)
    session.commit()
    session.refresh(db_run)
    return db_run

def update_generation_run_status(*, session: Session, run_id: uuid.UUID, status: str) -> GenerationRun | None:
    db_run = session.get(GenerationRun, run_id)
    if db_run:
        db_run.status = status
        session.add(db_run)
        session.commit()
        session.refresh(db_run)
    return db_run

def create_artifact_record(*, session: Session, artifact_in: ArtifactRecordCreate) -> ArtifactRecord:
    db_artifact = ArtifactRecord.model_validate(artifact_in)
    session.add(db_artifact)
    session.commit()
    session.refresh(db_artifact)
    return db_artifact

