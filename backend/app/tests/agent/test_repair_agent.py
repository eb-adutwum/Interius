import unittest
from unittest.mock import AsyncMock, patch

from app.agent.artifacts import (
    CodeFile,
    FilePatchRequest,
    GeneratedCode,
    RepairContext,
    ReviewReport,
    SystemArchitecture,
    TestFailure,
    TestRunReport,
)
from app.agent.repair_agent import RepairAgent


class RepairAgentTests(unittest.IsolatedAsyncioTestCase):
    def _architecture(self) -> SystemArchitecture:
        return SystemArchitecture(
            design_document="Simple CRUD API",
            mermaid_diagram="flowchart TD\nA[Client]-->B[API]",
            components=["API", "Persistence"],
            data_model_summary=["Todo(id, title)"],
            endpoint_summary=["GET /todos", "POST /todos"],
        )

    def _review_report(self) -> ReviewReport:
        return ReviewReport(
            issues=[],
            suggestions=[],
            security_score=8,
            approved=True,
            affected_files=[],
            patch_requests=[],
            final_code=[],
        )

    async def test_repair_agent_returns_without_changes_when_runtime_checks_pass(self):
        code = GeneratedCode(
            files=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n")],
            dependencies=["fastapi"],
        )

        passing_report = TestRunReport(
            passed=True,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[],
            warnings=[],
            patch_requests=[],
        )

        agent = RepairAgent(max_iterations=3)
        agent.test_runner.run = AsyncMock(return_value=passing_report)
        agent._sandbox_is_active = lambda _project_id: True

        report = await agent.run(
            RepairContext(
                architecture=self._architecture(),
                code=code,
                review_report=self._review_report(),
                project_id="123e4567-e89b-12d3-a456-426614174000",
            )
        )

        self.assertTrue(report.passed)
        self.assertFalse(report.repaired)
        self.assertEqual(report.attempts, 0)
        self.assertEqual([file.path for file in report.final_code], ["app/main.py"])
        agent.test_runner.run.assert_awaited_once_with(
            code,
            project_id="123e4567-e89b-12d3-a456-426614174000",
        )

    async def test_repair_agent_patches_files_until_runtime_checks_pass(self):
        original_code = GeneratedCode(
            files=[
                CodeFile(path="app/main.py", content="from app.routes import router\n"),
                CodeFile(path="app/routes.py", content="def broken():\n    pass\n"),
            ],
            dependencies=["fastapi"],
        )
        patched_code = GeneratedCode(
            files=[
                CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n"),
                CodeFile(path="app/routes.py", content="from fastapi import APIRouter\nrouter = APIRouter()\n"),
            ],
            dependencies=["fastapi"],
        )

        failing_report = TestRunReport(
            passed=False,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[
                TestFailure(
                    check="import_smoke",
                    message="Import smoke test failed: app startup crashed",
                    file_path="app/main.py",
                    line_number=1,
                    patchable=True,
                )
            ],
            warnings=[],
            patch_requests=[
                FilePatchRequest(
                    path="app/main.py",
                    reason="Deterministic tests failed for this file",
                    instructions=["Fix import_smoke failure (line 1): Import smoke test failed: app startup crashed"],
                )
            ],
        )
        passing_report = TestRunReport(
            passed=True,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[],
            warnings=[],
            patch_requests=[],
        )

        with patch("app.agent.repair_agent.ImplementerAgent") as implementer_cls:
            implementer = implementer_cls.return_value
            implementer.patch_files = AsyncMock(return_value=patched_code)

            agent = RepairAgent(max_iterations=3)
            agent.test_runner.run = AsyncMock(side_effect=[failing_report, passing_report])
            agent._sandbox_is_active = lambda _project_id: True

            report = await agent.run(
                RepairContext(
                    architecture=self._architecture(),
                    code=original_code,
                    review_report=self._review_report(),
                )
            )

        self.assertTrue(report.passed)
        self.assertTrue(report.repaired)
        self.assertEqual(report.attempts, 1)
        self.assertIn("app/main.py", report.affected_files)
        self.assertEqual([file.path for file in report.final_code], ["app/main.py", "app/routes.py"])
        implementer.patch_files.assert_awaited_once()

    async def test_repair_agent_escalates_to_broader_fix_passes_before_failing(self):
        original_code = GeneratedCode(
            files=[
                CodeFile(path="app/main.py", content="from app.routes import router\n"),
                CodeFile(path="app/routes.py", content="def broken():\n    pass\n"),
            ],
            dependencies=["fastapi"],
        )
        targeted_patch_code = GeneratedCode(
            files=[
                CodeFile(path="app/main.py", content="from app.routes import router\n"),
                CodeFile(path="app/routes.py", content="def still_broken():\n    pass\n"),
            ],
            dependencies=["fastapi"],
        )
        escalated_patch_code = GeneratedCode(
            files=[
                CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n"),
                CodeFile(path="app/routes.py", content="from fastapi import APIRouter\nrouter = APIRouter()\n"),
            ],
            dependencies=["fastapi"],
        )

        initial_failure = TestRunReport(
            passed=False,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[
                TestFailure(
                    check="import_smoke",
                    message="Sandbox failed to boot because the primary key model is invalid",
                    file_path="app/models.py",
                    line_number=12,
                    patchable=True,
                )
            ],
            warnings=[],
            patch_requests=[
                FilePatchRequest(
                    path="app/models.py",
                    reason="Deterministic tests failed for this file",
                    instructions=["Fix import_smoke failure (line 12): Sandbox failed to boot because the primary key model is invalid"],
                )
            ],
        )
        repeated_failure = TestRunReport(
            passed=False,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[
                TestFailure(
                    check="endpoint_smoke",
                    message="GET /items returned 500 Internal Server Error in the sandbox.",
                    file_path="app/routes.py",
                    line_number=3,
                    patchable=True,
                )
            ],
            warnings=[],
            patch_requests=[],
        )
        passing_report = TestRunReport(
            passed=True,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[],
            warnings=[],
            patch_requests=[],
        )

        with patch("app.agent.repair_agent.ImplementerAgent") as implementer_cls:
            implementer = implementer_cls.return_value
            implementer.patch_files = AsyncMock(side_effect=[targeted_patch_code, escalated_patch_code])

            agent = RepairAgent(max_iterations=1, escalation_iterations=2)
            agent.test_runner.run = AsyncMock(side_effect=[initial_failure, repeated_failure, passing_report])
            agent._sandbox_is_active = lambda _project_id: True

            report = await agent.run(
                RepairContext(
                    architecture=self._architecture(),
                    code=original_code,
                    review_report=self._review_report(),
                    project_id="123e4567-e89b-12d3-a456-426614174000",
                )
            )

        self.assertTrue(report.passed)
        self.assertTrue(report.repaired)
        self.assertEqual(report.attempts, 2)
        self.assertGreaterEqual(implementer.patch_files.await_count, 2)
        self.assertTrue(any(path in report.affected_files for path in ["app/models.py", "app/routes.py"]))
        self.assertIn("escalated sandbox fixes", report.summary)

    async def test_repair_agent_keeps_fixing_if_sandbox_is_not_alive_after_pass(self):
        original_code = GeneratedCode(
            files=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n")],
            dependencies=["fastapi"],
        )
        repaired_code = GeneratedCode(
            files=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI(title='fixed')\n")],
            dependencies=["fastapi"],
        )

        passing_report = TestRunReport(
            passed=True,
            checks_run=["syntax", "import_smoke", "endpoint_smoke"],
            failures=[],
            warnings=[],
            patch_requests=[],
        )

        with patch("app.agent.repair_agent.ImplementerAgent") as implementer_cls:
            implementer = implementer_cls.return_value
            implementer.patch_files = AsyncMock(return_value=repaired_code)

            agent = RepairAgent(max_iterations=1, escalation_iterations=1)
            agent.test_runner.run = AsyncMock(side_effect=[passing_report, passing_report])
            agent._sandbox_is_active = lambda _project_id: False if agent.test_runner.run.await_count < 2 else True

            report = await agent.run(
                RepairContext(
                    architecture=self._architecture(),
                    code=original_code,
                    review_report=self._review_report(),
                    project_id="123e4567-e89b-12d3-a456-426614174000",
                )
            )

        self.assertTrue(report.passed)
        self.assertTrue(report.repaired)
        self.assertEqual(report.attempts, 1)
        implementer.patch_files.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
