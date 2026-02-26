from __future__ import annotations

import re

from app.agent.artifacts import (
    CodeFile,
    CodeGenerationPlan,
    FilePatchRequest,
    GeneratedCode,
    PlannedCodeFile,
    SystemArchitecture,
)
from app.agent.base import BaseAgent
from app.agent.prompts.implementer import (
    IMPLEMENTER_FILE_SYSTEM_PROMPT,
    IMPLEMENTER_PATCH_FILE_SYSTEM_PROMPT,
    IMPLEMENTER_PLAN_SYSTEM_PROMPT,
)
from app.core.config import settings


class ImplementerAgent(BaseAgent[SystemArchitecture, GeneratedCode]):
    """
    Agent responsible for generating executable FastAPI source code based on a SystemArchitecture.
    """

    def __init__(self):
        super().__init__(model_name=settings.MODEL_IMPLEMENTER)

    @staticmethod
    def _architecture_package(input_data: SystemArchitecture) -> str:
        components = "\n".join(f"- {item}" for item in (input_data.components or [])) or "- (none)"
        data_model_summary = "\n".join(f"- {item}" for item in (input_data.data_model_summary or [])) or "- (none)"
        endpoint_summary = "\n".join(f"- {item}" for item in (input_data.endpoint_summary or [])) or "- (none)"
        return (
            "Architecture Package:\n\n"
            "Design Document (Markdown):\n"
            f"{input_data.design_document}\n\n"
            "Mermaid Diagram:\n"
            f"{input_data.mermaid_diagram}\n\n"
            "Components:\n"
            f"{components}\n\n"
            "Data Model Summary:\n"
            f"{data_model_summary}\n\n"
            "Endpoint Summary:\n"
            f"{endpoint_summary}"
        )

    @staticmethod
    def _sanitize_relative_path(path: str) -> str:
        normalized = (path or "").replace("\\", "/").strip().lstrip("/")
        normalized = re.sub(r"/{2,}", "/", normalized)
        normalized = normalized.replace("../", "").replace("..\\", "")
        if not normalized:
            return ""
        if normalized.endswith("/"):
            return normalized.rstrip("/")
        return normalized

    def _fallback_plan(self, input_data: SystemArchitecture) -> CodeGenerationPlan:
        architecture_text = " ".join(
            [
                input_data.design_document or "",
                input_data.mermaid_diagram or "",
                *list(input_data.components or []),
                *list(input_data.endpoint_summary or []),
            ]
        ).lower()
        auth_keywords = ("auth", "jwt", "token", "login", "signup", "user")
        auth_required = any(k in architecture_text for k in auth_keywords)

        files = [
            PlannedCodeFile(path="app/main.py", purpose="FastAPI app entrypoint and router registration"),
            PlannedCodeFile(path="app/database.py", purpose="SQLModel engine and session dependency"),
            PlannedCodeFile(path="app/models.py", purpose="SQLModel database models"),
            PlannedCodeFile(path="app/schemas.py", purpose="Pydantic/SQLModel request and response schemas"),
            PlannedCodeFile(path="app/routes.py", purpose="API CRUD endpoints and request handling"),
        ]
        if auth_required:
            files.append(PlannedCodeFile(path="app/auth.py", purpose="Authentication helpers and dependencies"))

        deps = ["fastapi", "sqlmodel", "uvicorn"]
        if auth_required:
            deps.append("python-jose[cryptography]")
            deps.append("passlib[bcrypt]")
        return CodeGenerationPlan(files=files, dependencies=deps)

    def _normalize_plan(self, plan: CodeGenerationPlan, input_data: SystemArchitecture) -> CodeGenerationPlan:
        fallback = self._fallback_plan(input_data)
        fallback_map = {f.path: f for f in fallback.files}

        normalized_files: list[PlannedCodeFile] = []
        seen: set[str] = set()
        for entry in plan.files or []:
            path = self._sanitize_relative_path(entry.path)
            if not path or path in seen:
                continue
            if not path.startswith("app/"):
                continue
            normalized_files.append(
                PlannedCodeFile(path=path, purpose=(entry.purpose or "").strip() or "Backend source file")
            )
            seen.add(path)
            if len(normalized_files) >= 8:
                break

        for required_path in ["app/main.py", "app/database.py", "app/models.py", "app/schemas.py", "app/routes.py"]:
            if required_path not in seen:
                normalized_files.append(fallback_map[required_path])
                seen.add(required_path)

        architecture_text = (input_data.design_document or "").lower()
        if (
            any(k in architecture_text for k in ("auth", "jwt", "login", "token"))
            and "app/auth.py" not in seen
            and "app/auth.py" in fallback_map
        ):
            normalized_files.append(fallback_map["app/auth.py"])

        deps = [d.strip() for d in (plan.dependencies or []) if isinstance(d, str) and d.strip()]
        if not deps:
            deps = fallback.dependencies
        # Ensure baseline deps always exist.
        for dep in fallback.dependencies:
            if dep not in deps:
                deps.append(dep)

        return CodeGenerationPlan(files=normalized_files, dependencies=deps)

    async def _generate_plan(self, architecture_package: str, input_data: SystemArchitecture) -> CodeGenerationPlan:
        try:
            plan = await self.llm.generate_structured(
                system_prompt=IMPLEMENTER_PLAN_SYSTEM_PROMPT,
                user_prompt=architecture_package,
                response_schema=CodeGenerationPlan,
            )
        except Exception:
            plan = self._fallback_plan(input_data)
        return self._normalize_plan(plan, input_data)

    async def _generate_file_content(
        self,
        *,
        architecture_package: str,
        plan: CodeGenerationPlan,
        file_entry: PlannedCodeFile,
    ) -> str:
        file_list = "\n".join(f"- {f.path}: {f.purpose}" for f in plan.files)
        deps = ", ".join(plan.dependencies or []) or "fastapi, sqlmodel, uvicorn"
        user_prompt = (
            f"{architecture_package}\n\n"
            "Planned Files:\n"
            f"{file_list}\n\n"
            f"Dependencies: {deps}\n\n"
            "Generate this file now:\n"
            f"Path: {file_entry.path}\n"
            f"Purpose: {file_entry.purpose}\n\n"
            "Return only the complete file content."
        )
        return await self.llm.generate_text(
            system_prompt=IMPLEMENTER_FILE_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.15,
        )

    async def _patch_file_content(
        self,
        *,
        architecture_package: str,
        plan: CodeGenerationPlan,
        file_entry: PlannedCodeFile,
        current_content: str,
        patch_request: FilePatchRequest,
        file_issues: list[str],
    ) -> str:
        file_list = "\n".join(f"- {f.path}: {f.purpose}" for f in plan.files)
        deps = ", ".join(plan.dependencies or []) or "fastapi, sqlmodel, uvicorn"
        issues_block = "\n".join(f"- {item}" for item in file_issues) or "- (none)"
        patch_instructions = "\n".join(f"- {item}" for item in (patch_request.instructions or [])) or "- (none)"
        user_prompt = (
            f"{architecture_package}\n\n"
            "Planned Files:\n"
            f"{file_list}\n\n"
            f"Dependencies: {deps}\n\n"
            "Regenerate this file to address reviewer feedback.\n"
            f"Path: {file_entry.path}\n"
            f"Purpose: {file_entry.purpose}\n\n"
            "Current File Content:\n"
            f"{current_content}\n\n"
            "Reviewer Reason:\n"
            f"- {patch_request.reason}\n\n"
            "Reviewer Issues For This File:\n"
            f"{issues_block}\n\n"
            "Reviewer Patch Instructions:\n"
            f"{patch_instructions}\n\n"
            "Return only the complete updated file content."
        )
        return await self.llm.generate_text(
            system_prompt=IMPLEMENTER_PATCH_FILE_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.1,
        )

    async def patch_files(
        self,
        *,
        architecture: SystemArchitecture,
        current_code: GeneratedCode,
        patch_requests: list[FilePatchRequest],
        review_issue_descriptions_by_file: dict[str, list[str]] | None = None,
    ) -> GeneratedCode:
        """
        Regenerate only selected files using reviewer guidance and reuse all other generated files unchanged.
        """
        review_issue_descriptions_by_file = review_issue_descriptions_by_file or {}
        architecture_package = self._architecture_package(architecture)

        current_map: dict[str, CodeFile] = {f.path: f for f in (current_code.files or []) if f.path}
        if not current_map:
            return current_code

        plan = CodeGenerationPlan(
            files=[
                PlannedCodeFile(
                    path=f.path,
                    purpose="Existing generated backend source file",
                )
                for f in current_code.files
            ],
            dependencies=list(current_code.dependencies or []),
        )

        patch_by_path: dict[str, FilePatchRequest] = {}
        for req in patch_requests or []:
            path = self._sanitize_relative_path(req.path)
            if not path or path not in current_map:
                continue
            patch_by_path[path] = FilePatchRequest(
                path=path,
                reason=(req.reason or "").strip() or "Reviewer requested fixes",
                instructions=[i.strip() for i in (req.instructions or []) if isinstance(i, str) and i.strip()],
            )

        if not patch_by_path:
            return current_code

        updated_map = dict(current_map)
        purpose_map = {f.path: f for f in plan.files}
        for path, patch_request in patch_by_path.items():
            file_entry = purpose_map.get(path) or PlannedCodeFile(path=path, purpose="Backend source file")
            current_content = current_map[path].content
            issues = review_issue_descriptions_by_file.get(path, [])
            new_content = await self._patch_file_content(
                architecture_package=architecture_package,
                plan=plan,
                file_entry=file_entry,
                current_content=current_content,
                patch_request=patch_request,
                file_issues=issues,
            )
            updated_map[path] = CodeFile(path=path, content=new_content)

        # Preserve original file order for stable UI rendering; append any new paths (should be rare).
        ordered_paths = [f.path for f in current_code.files if f.path in updated_map]
        ordered_paths.extend([p for p in updated_map.keys() if p not in ordered_paths])
        return GeneratedCode(
            files=[updated_map[p] for p in ordered_paths],
            dependencies=list(current_code.dependencies or []),
        )

    async def run(self, input_data: SystemArchitecture) -> GeneratedCode:
        """
        Generates code using a two-step process:
        1) small structured file plan
        2) per-file plain-text generation
        This avoids a single giant JSON response containing long code strings.
        """
        architecture_package = self._architecture_package(input_data)
        plan = await self._generate_plan(architecture_package, input_data)

        generated_files: list[CodeFile] = []
        for file_entry in plan.files:
            content = await self._generate_file_content(
                architecture_package=architecture_package,
                plan=plan,
                file_entry=file_entry,
            )
            generated_files.append(CodeFile(path=file_entry.path, content=content))

        return GeneratedCode(files=generated_files, dependencies=plan.dependencies)
