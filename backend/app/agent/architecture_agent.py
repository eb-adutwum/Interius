from app.agent.artifacts import ProjectCharter, SystemArchitecture
from app.agent.base import BaseAgent
from app.agent.prompts.architecture import ARCHITECTURE_SYSTEM_PROMPT


class ArchitectureAgent(BaseAgent[ProjectCharter, SystemArchitecture]):
    """
    Agent responsible for designing the system architecture based on a ProjectCharter.
    """

    async def run(self, input_data: ProjectCharter) -> SystemArchitecture:
        """
        Processes the ProjectCharter and returns a structured SystemArchitecture artifact.
        """
        prompt = f"Project Charter:\n{input_data.model_dump_json(indent=2)}"

        architecture = await self.llm.generate_structured(
            system_prompt=ARCHITECTURE_SYSTEM_PROMPT,
            user_prompt=prompt,
            response_schema=SystemArchitecture
        )

        return architecture
