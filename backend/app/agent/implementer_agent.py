from app.agent.artifacts import GeneratedCode, SystemArchitecture
from app.agent.base import BaseAgent
from app.agent.prompts.implementer import IMPLEMENTER_SYSTEM_PROMPT
from app.core.config import settings


class ImplementerAgent(BaseAgent[SystemArchitecture, GeneratedCode]):
    """
    Agent responsible for generating executable FastAPI source code based on a SystemArchitecture.
    """

    def __init__(self):
        super().__init__(model_name=settings.MODEL_IMPLEMENTER)

    async def run(self, input_data: SystemArchitecture) -> GeneratedCode:
        """
        Processes the SystemArchitecture and returns a structured GeneratedCode artifact
        containing all files and dependencies.
        """
        prompt = f"System Architecture:\n{input_data.model_dump_json(indent=2)}"

        code_artifact = await self.llm.generate_structured(
            system_prompt=IMPLEMENTER_SYSTEM_PROMPT,
            user_prompt=prompt,
            response_schema=GeneratedCode
        )

        return code_artifact
