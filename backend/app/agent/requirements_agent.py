from app.agent.artifacts import ProjectCharter
from app.agent.base import BaseAgent
from app.agent.prompts.requirements import REQUIREMENTS_SYSTEM_PROMPT


class RequirementsAgent(BaseAgent[str, ProjectCharter]):
    """
    Agent responsible for extracting a structured ProjectCharter
    from a user's raw prompt plus document context.
    """

    async def run(self, input_data: str) -> ProjectCharter:
        """
        Processes the input text and returns a structured ProjectCharter artifact.
        `input_data` is the combined text from the user's prompt and any injected RAG context.
        """
        charter = await self.llm.generate_structured(
            system_prompt=REQUIREMENTS_SYSTEM_PROMPT,
            user_prompt=input_data,
            response_schema=ProjectCharter
        )

        # Post-validation: Ensure at least one entity and one endpoint exists.
        if not charter.entities:
            raise ValueError("RequirementsAgent failed to extract any entities.")
        if not charter.endpoints:
            raise ValueError("RequirementsAgent failed to extract any endpoints.")

        return charter
