from app.agent.artifacts import GeneratedCode, ReviewReport
from app.agent.base import BaseAgent
from app.agent.prompts.reviewer import REVIEWER_SYSTEM_PROMPT
from app.core.config import settings


class ReviewerAgent(BaseAgent[GeneratedCode, ReviewReport]):
    """
    Agent responsible for reviewing and fixing generated code logic and security.
    """

    def __init__(self):
        super().__init__(model_name=settings.MODEL_REVIEWER)

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

        return review_report
