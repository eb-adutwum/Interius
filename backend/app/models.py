import uuid
from datetime import datetime, timezone

from pydantic import EmailStr
from sqlalchemy import DateTime, JSON
from sqlmodel import Field, Relationship, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class DocumentBase(SQLModel):
    filename: str = Field(max_length=255)
    content_type: str = Field(max_length=100)
    project_id: str = Field(index=True)


class DocumentCreate(DocumentBase):
    pass


class Document(DocumentBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    
class DocumentPublic(DocumentBase):
    id: uuid.UUID
    created_at: datetime | None = None


# Pipeline Models

class ProjectBase(SQLModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None)

class ProjectCreate(ProjectBase):
    pass

class Project(ProjectBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    runs: list["GenerationRun"] = Relationship(back_populates="project", cascade_delete=True)

class ProjectPublic(ProjectBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime | None = None


class GenerationRunBase(SQLModel):
    status: str = Field(default="pending") # pending, requirements, architecture, implementer, reviewer, completed, failed
    prompt: str = Field(max_length=5000)

class GenerationRunCreate(GenerationRunBase):
    project_id: uuid.UUID

class GenerationRun(GenerationRunBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    project_id: uuid.UUID = Field(
        foreign_key="project.id", nullable=False, ondelete="CASCADE"
    )
    project: Project | None = Relationship(back_populates="runs")
    artifacts: list["ArtifactRecord"] = Relationship(back_populates="run", cascade_delete=True)

class GenerationRunPublic(GenerationRunBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime | None = None
    
class GenerationRunsPublic(SQLModel):
    data: list[GenerationRunPublic]
    count: int


class ArtifactRecordBase(SQLModel):
    stage: str = Field(max_length=100) # requirements, architecture, code, review
    content: dict = Field(default_factory=dict, sa_type=JSON) # Pydantic model dumped to dict

class ArtifactRecordCreate(ArtifactRecordBase):
    run_id: uuid.UUID

class ArtifactRecord(ArtifactRecordBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    run_id: uuid.UUID = Field(
        foreign_key="generationrun.id", nullable=False, ondelete="CASCADE"
    )
    run: GenerationRun | None = Relationship(back_populates="artifacts")

class ArtifactRecordPublic(ArtifactRecordBase):
    id: uuid.UUID
    run_id: uuid.UUID
    created_at: datetime | None = None

class GenerationRunWithArtifacts(GenerationRunPublic):
    artifacts: list[ArtifactRecordPublic]


