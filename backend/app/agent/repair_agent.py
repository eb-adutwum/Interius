from __future__ import annotations

import uuid

from app.agent.artifacts import (
    FilePatchRequest,
    RepairContext,
    RepairReport,
    TestFailure,
    TestRunReport,
)
from app.agent.implementer_agent import ImplementerAgent
from app.agent.test_runner import TestRunner


class RepairAgent:
    """
    Bounded runtime repair loop that patches only affected files until
    deterministic runtime checks pass or the iteration cap is reached.
    """

    def __init__(self, max_iterations: int = 3, escalation_iterations: int = 2):
        self.max_iterations = max_iterations
        self.escalation_iterations = escalation_iterations
        self.implementer = ImplementerAgent()
        self.test_runner = TestRunner()

    @staticmethod
    def _review_issue_map(input_data: RepairContext) -> dict[str, list[str]]:
        issue_map: dict[str, list[str]] = {}
        review_report = input_data.review_report
        if not review_report:
            return issue_map
        for issue in review_report.issues or []:
            path = (issue.file_path or "").strip()
            if not path:
                continue
            issue_map.setdefault(path, []).append(f"[{issue.severity}] {issue.description}")
        return issue_map

    @staticmethod
    def _select_fallback_path(code_files: list, failure: TestFailure) -> str | None:
        if failure.file_path:
            return failure.file_path
        candidate_names = ["app/routes.py", "app/main.py", "app/schemas.py", "app/models.py", "app/service.py", "app/services.py"]
        existing_paths = [str(file.path or "") for file in code_files]
        for candidate in candidate_names:
            if candidate in existing_paths:
                return candidate
        return existing_paths[0] if existing_paths else None

    @classmethod
    def _fallback_patch_requests(cls, code_files: list, failures: list[TestFailure]) -> list[FilePatchRequest]:
        by_path: dict[str, list[str]] = {}
        for failure in failures:
            path = cls._select_fallback_path(code_files, failure)
            if not path:
                continue
            loc = f" (line {failure.line_number})" if failure.line_number else ""
            by_path.setdefault(path, []).append(f"Fix {failure.check} failure{loc}: {failure.message}")
        return [
            FilePatchRequest(
                path=path,
                reason="Runtime repair loop found startup or endpoint smoke failures",
                instructions=instructions,
            )
            for path, instructions in by_path.items()
        ]

    @staticmethod
    def _merge_patch_requests(*collections: list[FilePatchRequest]) -> list[FilePatchRequest]:
        merged: list[FilePatchRequest] = []
        seen: set[tuple[str, str, tuple[str, ...]]] = set()
        for collection in collections:
            for request in collection or []:
                key = (
                    request.path,
                    request.reason,
                    tuple(request.instructions or []),
                )
                if key in seen:
                    continue
                seen.add(key)
                merged.append(request)
        return merged

    async def evaluate(self, code, project_id: str | None = None) -> TestRunReport:
        return await self.test_runner.run(code, project_id=project_id)

    @staticmethod
    def _sandbox_is_active(project_id: str | None) -> bool:
        if not project_id:
            return False
        try:
            from app.api.routes.sandbox import _is_sandbox_live

            return _is_sandbox_live(uuid.UUID(project_id))
        except Exception:
            return False

    def _ensure_live_sandbox_after_success(
        self,
        report: TestRunReport,
        *,
        project_id: str | None,
    ) -> TestRunReport:
        if not report.passed or not project_id:
            return report
        if self._sandbox_is_active(project_id):
            return report

        failures = list(report.failures or [])
        failures.append(
            TestFailure(
                check="import_smoke",
                message="Sandbox validation passed but the container was not still running afterward. Restart and fix the runtime lifecycle before release.",
                file_path="app/main.py",
                line_number=1,
                patchable=True,
            )
        )
        return TestRunReport(
            passed=False,
            checks_run=list(report.checks_run or []),
            failures=failures,
            warnings=list(report.warnings or []),
            patch_requests=list(report.patch_requests or []),
        )

    def build_repair_requests(
        self,
        input_data: RepairContext,
        current_code,
        test_report: TestRunReport,
    ) -> tuple[list[FilePatchRequest], dict[str, list[str]]]:
        issue_map = self._review_issue_map(input_data)
        patch_requests = self._merge_patch_requests(
            list(test_report.patch_requests or []),
            self._fallback_patch_requests(list(current_code.files or []), list(test_report.failures or [])),
        )
        return patch_requests, issue_map

    @classmethod
    def _build_escalation_patch_requests(
        cls,
        code_files: list,
        failures: list[TestFailure],
        affected_files: list[str],
    ) -> list[FilePatchRequest]:
        target_paths = [
            path
            for path in affected_files
            if isinstance(path, str) and path.strip()
        ]
        if not target_paths:
            for failure in failures:
                selected = cls._select_fallback_path(code_files, failure)
                if selected and selected not in target_paths:
                    target_paths.append(selected)

        if not target_paths:
            target_paths = [
                str(file.path or "")
                for file in code_files
                if str(file.path or "").strip()
            ][:3]

        if not target_paths:
            return []

        instructions = [
            "Resolve the remaining sandbox startup, container-log, and endpoint smoke failures together. "
            "Do not preserve the broken implementation if a more direct rewrite is needed.",
        ]
        for failure in failures:
            loc = f" (line {failure.line_number})" if failure.line_number else ""
            instructions.append(f"Remaining {failure.check} failure{loc}: {failure.message}")

        return [
            FilePatchRequest(
                path=path,
                reason="Escalated runtime repair after sandbox-backed checks still failed",
                instructions=instructions,
            )
            for path in target_paths
        ]

    async def run(self, input_data: RepairContext) -> RepairReport:
        current_code = input_data.code
        repair_attempts = 0
        repaired = False
        affected_files: list[str] = []

        latest_report = self._ensure_live_sandbox_after_success(
            await self.evaluate(current_code, project_id=input_data.project_id),
            project_id=input_data.project_id,
        )
        if latest_report.passed:
            return RepairReport(
                passed=True,
                repaired=False,
                attempts=0,
                affected_files=[],
                failures=[],
                warnings=list(latest_report.warnings or []),
                patch_requests=[],
                final_code=list(current_code.files or []),
                summary="Runtime repair checks passed without additional repairs.",
            )

        while repair_attempts < self.max_iterations:
            patch_requests, issue_map = self.build_repair_requests(input_data, current_code, latest_report)
            if not patch_requests:
                break

            repair_attempts += 1
            repaired = True
            for request in patch_requests:
                if request.path and request.path not in affected_files:
                    affected_files.append(request.path)

            current_code = await self.implementer.patch_files(
                architecture=input_data.architecture,
                current_code=current_code,
                patch_requests=patch_requests,
                review_issue_descriptions_by_file=issue_map,
            )

            latest_report = self._ensure_live_sandbox_after_success(
                await self.evaluate(current_code, project_id=input_data.project_id),
                project_id=input_data.project_id,
            )
            if latest_report.passed:
                return RepairReport(
                    passed=True,
                    repaired=True,
                    attempts=repair_attempts,
                    affected_files=affected_files,
                    failures=[],
                    warnings=list(latest_report.warnings or []),
                    patch_requests=[],
                    final_code=list(current_code.files or []),
                    summary=f"Repair loop fixed runtime issues in {repair_attempts} pass(es).",
                )

        escalation_attempts = 0
        while escalation_attempts < self.escalation_iterations:
            escalation_patch_requests = self._build_escalation_patch_requests(
                list(current_code.files or []),
                list(latest_report.failures or []),
                affected_files,
            )
            if not escalation_patch_requests:
                break

            escalation_attempts += 1
            repair_attempts += 1
            repaired = True
            for request in escalation_patch_requests:
                if request.path and request.path not in affected_files:
                    affected_files.append(request.path)

            current_code = await self.implementer.patch_files(
                architecture=input_data.architecture,
                current_code=current_code,
                patch_requests=escalation_patch_requests,
                review_issue_descriptions_by_file=self._review_issue_map(input_data),
            )

            latest_report = self._ensure_live_sandbox_after_success(
                await self.evaluate(current_code, project_id=input_data.project_id),
                project_id=input_data.project_id,
            )
            if latest_report.passed:
                return RepairReport(
                    passed=True,
                    repaired=True,
                    attempts=repair_attempts,
                    affected_files=affected_files,
                    failures=[],
                    warnings=list(latest_report.warnings or []),
                    patch_requests=[],
                    final_code=list(current_code.files or []),
                    summary=f"Repair loop fixed runtime issues in {repair_attempts} pass(es), including escalated sandbox fixes.",
                )

        return RepairReport(
            passed=False,
            repaired=repaired,
            attempts=repair_attempts,
            affected_files=affected_files,
            failures=list(latest_report.failures or []),
            warnings=list(latest_report.warnings or []),
            patch_requests=list(latest_report.patch_requests or []),
            final_code=list(current_code.files or []),
            summary=(
                f"Repair loop exhausted after {repair_attempts} pass(es) and runtime issues remain."
                if repaired
                else "Runtime issues remain and no repairable files could be identified."
            ),
        )
