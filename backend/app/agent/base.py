from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from pydantic import BaseModel

from app.agent.llm_client import LLMClient
from app.core.config import settings

InType = TypeVar("InType", bound=BaseModel | str)
OutType = TypeVar("OutType", bound=BaseModel)

class BaseAgent(ABC, Generic[InType, OutType]):
    """Abstract base class for all agents in the pipeline."""

    def __init__(self, model_name: str | None = None):
        model_to_use = model_name or settings.MODEL_DEFAULT
        self.llm = LLMClient(model_name=model_to_use)

    @abstractmethod
    async def run(self, input_data: InType) -> OutType:
        """Run the agent on the given input to produce the output artifact."""
        pass

    def get_system_prompt(self, **kwargs) -> str:
        """Optional helper to format the system prompt."""
        return ""
