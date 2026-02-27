from typing import Literal

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


class SystemArchitecture(BaseModel):
    """Lightweight artifact produced by the Architecture Agent for UI rendering + implementer guidance."""
    design_document: str = Field(
        description="Markdown-formatted backend architecture design document focused on request flow, backend components, persistence, auth, and entrypoints."
    )
    mermaid_diagram: str = Field(
        description="Mermaid diagram code representing the high-level backend runtime architecture and component interactions. Return only Mermaid syntax, no markdown fence."
    )
    components: list[str] = Field(
        default_factory=list,
        description="Short bullet-style summaries of backend components and responsibilities (e.g., API entrypoint, routers, services, auth dependencies, repositories, database session handling).",
    )
    data_model_summary: list[str] = Field(
        default_factory=list,
        description="Compact summaries of backend entities/tables and key relationships relevant to persistence and request handling.",
    )
    endpoint_summary: list[str] = Field(
        default_factory=list,
        description="Compact summaries of the main backend endpoint groups, handlers, and responsibilities.",
    )


class CodeFile(BaseModel):
    path: str = Field(description="Relative path of the file to create/update like 'app/models.py'")
    content: str = Field(description="Complete source code of the file")


class PlannedCodeFile(BaseModel):
    path: str = Field(description="Relative file path to generate, e.g. 'app/main.py'")
    purpose: str = Field(description="Short description of what the file contains")


class CodeGenerationPlan(BaseModel):
    """Small structured plan used before per-file generation to avoid giant JSON-with-code payloads."""
    files: list[PlannedCodeFile] = Field(description="Files to generate for the backend scaffold")
    dependencies: list[str] = Field(description="Pip packages required by the generated code")


class GeneratedCode(BaseModel):
    """Artifact produced by the Implementer Agent."""
    files: list[CodeFile] = Field(description="Generated Python files")
    dependencies: list[str] = Field(description="Pip packages required")


class Issue(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    description: str
    file_path: str
    line_number: int | None = None


class FilePatchRequest(BaseModel):
    path: str = Field(description="Relative file path to patch, e.g. 'app/routes.py'")
    reason: str = Field(description="Why this file needs changes")
    instructions: list[str] = Field(
        default_factory=list,
        description="Concrete edit instructions for regenerating this file",
    )


class ReviewReport(BaseModel):
    """Artifact produced by the Reviewer Agent."""
    issues: list[Issue] = Field(description="Issues found during code review")
    suggestions: list[str] = Field(description="Actionable suggestions for improvement")
    security_score: int = Field(ge=1, le=10, description="Security score from 1 to 10")
    approved: bool = Field(description="Whether the code is approved for use")
    affected_files: list[str] = Field(
        default_factory=list,
        description="File paths that need changes before approval.",
    )
    patch_requests: list[FilePatchRequest] = Field(
        default_factory=list,
        description="Targeted file patch requests for the implementer. Prefer this over rewriting full code.",
    )
    final_code: list[CodeFile] = Field(
        default_factory=list,
        description="Optional rewritten files. Prefer leaving empty and using patch_requests unless only a tiny fix is needed."
    )


class TestFailure(BaseModel):
    check: Literal["syntax", "import_smoke"]
    message: str
    file_path: str | None = None
    line_number: int | None = None
    patchable: bool = True


class TestRunReport(BaseModel):
    passed: bool = Field(description="Whether all blocking test checks passed")
    checks_run: list[str] = Field(default_factory=list, description="Deterministic checks executed")
    failures: list[TestFailure] = Field(default_factory=list, description="Blocking test failures")
    warnings: list[str] = Field(default_factory=list, description="Non-blocking warnings (e.g., missing external deps)")
    patch_requests: list[FilePatchRequest] = Field(
        default_factory=list,
        description="Targeted file patch requests derived from deterministic test failures",
    )
