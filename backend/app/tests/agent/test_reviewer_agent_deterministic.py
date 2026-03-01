import unittest
from unittest.mock import AsyncMock, patch

from app.agent.artifacts import CodeFile, GeneratedCode, ReviewReport
from app.agent.reviewer_agent import ReviewerAgent


class ReviewerAgentDeterministicTests(unittest.IsolatedAsyncioTestCase):
    async def test_reviewer_agent_rejects_validator_failures(self):
        generated_code = GeneratedCode(
            files=[
                CodeFile(
                    path="app/routes.py",
                    content=(
                        "from app import service\n\n"
                        "def handler(session):\n"
                        "    return service.list_todos(session=session, due_date_before=None)\n"
                    ),
                ),
                CodeFile(
                    path="app/service.py",
                    content="def list_todos(*, db, due_before=None):\n    return []\n",
                ),
            ],
            dependencies=[],
        )

        llm_result = {
            "issues": [],
            "suggestions": [],
            "security_score": 9,
            "approved": True,
            "affected_files": [],
            "patch_requests": [],
            "final_code": [],
        }

        with patch("app.agent.reviewer_agent.settings.MODEL_REVIEWER", "dummy-model"):
            agent = ReviewerAgent()
            agent.llm.generate_structured = AsyncMock(return_value=ReviewReport.model_validate(llm_result))
            report = await agent.run(generated_code)

        self.assertFalse(report.approved)
        self.assertEqual(report.security_score, 6)
        self.assertIn("app/routes.py", report.affected_files)
        self.assertTrue(
            any(
                "unsupported keyword(s):" in issue.description
                and "session" in issue.description
                and "due_date_before" in issue.description
                for issue in report.issues
            )
        )
        self.assertTrue(any(request.path == "app/routes.py" for request in report.patch_requests))

if __name__ == "__main__":
    unittest.main()
