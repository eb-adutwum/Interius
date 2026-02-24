import json
import logging
import re
from typing import TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

class LLMClient:
    """Provider-agnostic LLM Client for structured generation using the OpenAI API spec."""

    def __init__(
        self,
        model_name: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self.model_name = model_name or settings.MODEL_DEFAULT

        # Use LLM_API_KEY or fallback to GEMINI_API_KEY if they only provided the original one
        resolved_api_key = api_key or settings.LLM_API_KEY or settings.GEMINI_API_KEY
        resolved_base_url = base_url or settings.LLM_BASE_URL

        self.client = AsyncOpenAI(
            base_url=resolved_base_url,
            api_key=resolved_api_key,
        )

    async def generate_structured(
        self, system_prompt: str, user_prompt: str, response_schema: type[T]
    ) -> T:
        """
        Generate a structured response matching the provided Pydantic schema.
        Uses JSON mode and injects the schema requirement into the system prompt.
        """
        schema_json = json.dumps(response_schema.model_json_schema())

        augmented_system_prompt = (
            f"{system_prompt}\n\n"
            "CRITICAL: You must respond in ONLY valid JSON format matching the following JSON Schema. "
            "Do not include markdown code blocks (```json) or any conversational text around the JSON.\n\n"
            f"EXPECTED SCHEMA:\n{schema_json}"
        )

        try:
            logger.info(f"Issuing request to model {self.model_name}...")
            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": augmented_system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                # Some free models fail violently on this format flag, so we rely on the prompt instead
                # response_format={"type": "json_object"},
                temperature=0.2,
            )
            logger.info(f"Successfully received response from {self.model_name}.")

            if getattr(response, "choices", None) is None:
                logger.error(f"Received invalid response structure from {self.model_name}: {response}")
                raise ValueError(f"Provider {self.model_name} returned an invalid response. Try a different model in .env.")
                
            if len(response.choices) == 0:
                logger.error(f"Received 0 choices from {self.model_name}: {response}")
                raise ValueError(f"Provider {self.model_name} returned no output. Try again or change model.")

            text_response = response.choices[0].message.content or "{}"

            # Clean up markdown formatting if the model leaked it despite instructions
            if "```" in text_response:
                # Isolate everything inside the first ```...``` block
                blocks = re.findall(r"```(?:json)?\s*(.*?)\s*```", text_response, re.DOTALL)
                if blocks:
                    text_response = blocks[0]
            
            # Additional fallback to locate the outermost JSON brackets if conversational text is present
            text_response = text_response.strip()
            if not (text_response.startswith("{") or text_response.startswith("[")):
                start_idx = text_response.find("{")
                end_idx = text_response.rfind("}")
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    text_response = text_response[start_idx:end_idx+1]

            # Use strict=False to tolerate literal control characters (like \n) inside JSON string values
            parsed_data = json.loads(text_response, strict=False)
            return response_schema.model_validate(parsed_data)

        except Exception as e:
            logger.error(f"Error calling LLM provider or parsing response: {e}")
            raise
