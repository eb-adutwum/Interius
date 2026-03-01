from app.agent.artifacts import GeneratedCode, Issue, ReviewReport, TestRunReport
from app.agent.base import BaseAgent
from app.agent.code_validator import validate_generated_backend
from app.agent.prompts.reviewer import REVIEWER_SYSTEM_PROMPT
from app.core.config import settings


class ReviewerAgent(BaseAgent[GeneratedCode, ReviewReport]):
    """
    Agent responsible for reviewing and fixing generated code logic and security.
    """

    def __init__(self):
        super().__init__(model_name=settings.MODEL_REVIEWER)

    @staticmethod
    def _merge_deterministic_report(
        review_report: ReviewReport,
        deterministic_report: TestRunReport,
        *,
        suggestion: str,
    ) -> ReviewReport:
        if not deterministic_report.failures:
            if deterministic_report.warnings:
                review_report.suggestions.extend(
                    warning for warning in deterministic_report.warnings if warning not in (review_report.suggestions or [])
                )
            return review_report

        existing_issue_keys = {
            (issue.file_path, issue.description, issue.line_number)
            for issue in (review_report.issues or [])
        }
        existing_patch_keys = {
            (request.path, request.reason, tuple(request.instructions or []))
            for request in (review_report.patch_requests or [])
        }
        existing_suggestions = set(review_report.suggestions or [])
        affected_files = list(review_report.affected_files or [])

        for failure in deterministic_report.failures:
            key = (failure.file_path or "", failure.message, failure.line_number)
            if key not in existing_issue_keys:
                review_report.issues.append(
                    Issue(
                        severity="high",
                        description=failure.message,
                        file_path=failure.file_path or "",
                        line_number=failure.line_number,
                    )
                )
                existing_issue_keys.add(key)
            if failure.file_path and failure.file_path not in affected_files:
                affected_files.append(failure.file_path)

        for patch_request in deterministic_report.patch_requests:
            patch_key = (patch_request.path, patch_request.reason, tuple(patch_request.instructions or []))
            if patch_key in existing_patch_keys:
                continue
            review_report.patch_requests.append(patch_request)
            existing_patch_keys.add(patch_key)

        for warning in deterministic_report.warnings or []:
            if warning not in existing_suggestions:
                review_report.suggestions.append(warning)
                existing_suggestions.add(warning)

        if suggestion not in existing_suggestions:
            review_report.suggestions.append(suggestion)

        review_report.affected_files = affected_files
        review_report.approved = False
        review_report.security_score = min(review_report.security_score, 6)
        return review_report

    async def run(self, input_data: GeneratedCode) -> ReviewReport:
        """
        Processes the GeneratedCode and returns a ReviewReport artifact,
        which includes the final verified (and potentially fixed) code.
        """
        prompt = "Files to Review:\n"
        for code_file in input_data.files:
            prompt += f"\n--- {code_file.path} ---\n{code_file.content}\n"

        review_report = await self.llm.generate_structured(
            system_prompt=REVIEWER_SYSTEM_PROMPT,
            user_prompt=prompt,
            response_schema=ReviewReport
        )

        validator_report = validate_generated_backend(input_data)
        review_report = self._merge_deterministic_report(
            review_report,
            validator_report,
            suggestion="Deterministic validator found unresolved cross-file import or function-contract issues. Fix those before approval.",
        )

        return review_report
