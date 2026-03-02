import json
import uuid
import unittest
from unittest.mock import AsyncMock, patch

from app.agent.artifacts import (
    CodeFile,
    GeneratedCode,
    ProjectCharter,
    RepairReport,
    ReviewReport,
    SystemArchitecture,
    TestFailure,
)
from app.agent.orchestrator import run_pipeline_generator


class OrchestratorReleaseGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_deployable_repair_result_completes_pipeline_with_warnings(self):
        charter = ProjectCharter(
            project_name="Todo API",
            description="Simple todo backend",
            entities=[],
            endpoints=[],
            business_rules=[],
            auth_required=False,
        )
        architecture = SystemArchitecture(
            design_document="Architecture",
            mermaid_diagram="flowchart TD\nA-->B",
            components=[],
            data_model_summary=[],
            endpoint_summary=[],
        )
        code = GeneratedCode(
            files=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n")],
            dependencies=["fastapi"],
        )
        review = ReviewReport(
            issues=[],
            suggestions=[],
            security_score=8,
            approved=True,
            affected_files=[],
            patch_requests=[],
            final_code=[],
        )
        repair = RepairReport(
            passed=True,
            fully_validated=False,
            repaired=False,
            attempts=0,
            affected_files=[],
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
            final_code=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n")],
            summary="Generated API is deployable. Some endpoint smoke checks still reported warnings, but artifacts are being returned.",
        )

        with patch("app.agent.orchestrator.RequirementsAgent") as req_cls, \
             patch("app.agent.orchestrator.ArchitectureAgent") as arch_cls, \
             patch("app.agent.orchestrator.ImplementerAgent") as imp_cls, \
             patch("app.agent.orchestrator.ReviewerAgent") as rev_cls, \
             patch("app.agent.orchestrator.RepairAgent") as repair_cls, \
             patch("app.agent.orchestrator.create_artifact_record"), \
             patch("app.agent.orchestrator.store_code_bundle", return_value="bundle-ref"), \
             patch("app.agent.orchestrator._update_run_status_safely"):
            req_cls.return_value.run = AsyncMock(return_value=charter)
            arch_cls.return_value.run = AsyncMock(return_value=architecture)
            imp_cls.return_value.run = AsyncMock(return_value=code)
            rev_cls.return_value.run = AsyncMock(return_value=review)
            repair_cls.return_value.run = AsyncMock(return_value=repair)

            events = []
            async for event in run_pipeline_generator(
                session=object(),
                project_id=uuid.uuid4(),
                run_id=uuid.uuid4(),
                prompt="Build a todo API",
                runtime_mode="sandbox",
            ):
                events.append(json.loads(event))

        statuses = [event.get("status") for event in events]
        self.assertIn("repairer_done", statuses)
        self.assertIn("completed", statuses)
        self.assertNotIn("error", statuses)
        completed_event = next(event for event in events if event.get("status") == "completed")
        self.assertIn("deployable artifacts", completed_event.get("message", ""))

    async def test_failed_repair_still_completes_with_generated_artifacts(self):
        charter = ProjectCharter(
            project_name="Task Manager",
            description="Simple task backend",
            entities=[],
            endpoints=[],
            business_rules=[],
            auth_required=False,
        )
        architecture = SystemArchitecture(
            design_document="Architecture",
            mermaid_diagram="flowchart TD\nA-->B",
            components=[],
            data_model_summary=[],
            endpoint_summary=[],
        )
        code = GeneratedCode(
            files=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n")],
            dependencies=["fastapi"],
        )
        review = ReviewReport(
            issues=[],
            suggestions=[],
            security_score=4,
            approved=False,
            affected_files=["app/routes.py"],
            patch_requests=[],
            final_code=[],
        )
        repair = RepairReport(
            passed=False,
            fully_validated=False,
            repaired=True,
            attempts=5,
            affected_files=["app/routes.py"],
            failures=[
                TestFailure(
                    check="endpoint_smoke",
                    message="GET /tasks returned 500 in the sandbox.",
                    file_path="app/routes.py",
                    line_number=12,
                    patchable=True,
                )
            ],
            warnings=[],
            patch_requests=[],
            final_code=[CodeFile(path="app/main.py", content="from fastapi import FastAPI\napp = FastAPI()\n")],
            summary="Repair loop exhausted after 5 pass(es) and runtime issues remain.",
        )

        with patch("app.agent.orchestrator.RequirementsAgent") as req_cls, \
             patch("app.agent.orchestrator.ArchitectureAgent") as arch_cls, \
             patch("app.agent.orchestrator.ImplementerAgent") as imp_cls, \
             patch("app.agent.orchestrator.ReviewerAgent") as rev_cls, \
             patch("app.agent.orchestrator.RepairAgent") as repair_cls, \
             patch("app.agent.orchestrator.create_artifact_record"), \
             patch("app.agent.orchestrator.store_code_bundle", return_value="bundle-ref"), \
             patch("app.agent.orchestrator._update_run_status_safely"):
            req_cls.return_value.run = AsyncMock(return_value=charter)
            arch_cls.return_value.run = AsyncMock(return_value=architecture)
            imp_cls.return_value.run = AsyncMock(return_value=code)
            rev_cls.return_value.run = AsyncMock(return_value=review)
            repair_cls.return_value.run = AsyncMock(return_value=repair)

            events = []
            async for event in run_pipeline_generator(
                session=object(),
                project_id=uuid.uuid4(),
                run_id=uuid.uuid4(),
                prompt="Build a task manager",
                runtime_mode="sandbox",
            ):
                events.append(json.loads(event))

        statuses = [event.get("status") for event in events]
        self.assertIn("repairer_done", statuses)
        self.assertIn("completed", statuses)
        self.assertNotIn("error", statuses)
        completed_event = next(event for event in events if event.get("status") == "completed")
        self.assertIn("generated artifacts", completed_event.get("message", ""))
        artifact = completed_event.get("artifact") or {}
        self.assertFalse(artifact.get("approved"))
        self.assertTrue(artifact.get("artifacts_released"))
        self.assertEqual(len(artifact.get("final_code") or []), 1)


if __name__ == "__main__":
    unittest.main()
