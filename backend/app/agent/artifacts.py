from typing import Literal, Any

from pydantic import BaseModel, Field


class EntityField(BaseModel):
    name: str = Field(description="Name of the field (e.g., 'title', 'price')")
    field_type: str = Field(description="Type of the field (e.g., 'str', 'int', 'float', 'datetime', 'bool')")
    required: bool = True


class Entity(BaseModel):
    name: str = Field(description="Name of the entity (e.g., 'Book', 'User')")
    fields: list[EntityField] = Field(description="Fields belonging to the entity")


class Endpoint(BaseModel):
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"] = Field(description="HTTP method")
    path: str = Field(description="Endpoint path (e.g., '/books')")
    description: str = Field(description="What this endpoint does")


class ProjectCharter(BaseModel):
    """Artifact produced by the Requirements Agent."""
    project_name: str = Field(description="Name of the project")
    description: str = Field(description="High-level description of what the project does")
    entities: list[Entity] = Field(description="Data entities extracted from the requirements")
    endpoints: list[Endpoint] = Field(description="REST API endpoints needed")
    business_rules: list[str] = Field(description="Any specific business logic rules or constraints")
    auth_required: bool = Field(description="Whether the API requires authentication")


class DBModelSpec(BaseModel):
    table_name: str
    columns: list[dict[str, Any]]  # list of {"name": "id", "type": "uuid.UUID", "primary_key": True}
    relationships: list[dict[str, Any]]


class EndpointSpec(BaseModel):
    method: str
    path: str
    description: str
    request_schema: str | None
    response_schema: str | None


class SystemArchitecture(BaseModel):
    """Artifact produced by the Architecture Agent."""
    design_document: str = Field(description="A detailed Markdown-formatted design document explaining the system architecture, design decisions, and patterns to build a robust application")
    db_models: list[DBModelSpec] = Field(description="Specifications for SQLModel classes")
    endpoint_specs: list[EndpointSpec] = Field(description="Detailed API contracts")


class CodeFile(BaseModel):
    path: str = Field(description="Relative path of the file to create/update like 'app/models.py'")
    content: str = Field(description="Complete source code of the file")


class GeneratedCode(BaseModel):
    """Artifact produced by the Implementer Agent."""
    files: list[CodeFile] = Field(description="Generated Python files")
    dependencies: list[str] = Field(description="Pip packages required")


class Issue(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    description: str
    file_path: str
    line_number: int | None = None


class ReviewReport(BaseModel):
    """Artifact produced by the Reviewer Agent."""
    issues: list[Issue] = Field(description="Issues found during code review")
    suggestions: list[str] = Field(description="Actionable suggestions for improvement")
    security_score: int = Field(ge=1, le=10, description="Security score from 1 to 10")
    approved: bool = Field(description="Whether the code is approved for use")
    final_code: list[CodeFile] = Field(description="Final modified code with fixes applied")
