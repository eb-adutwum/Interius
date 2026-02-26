import json
import logging
import re
from typing import TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def _extract_fenced_block(text: str) -> str | None:
    blocks = re.findall(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    return blocks[0].strip() if blocks else None


def _strip_code_fences(text: str) -> str:
    if not text:
        return ""
    fenced = re.match(r"^\s*```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```\s*$", text)
    if fenced:
        return fenced.group(1).strip()
    return text.strip()


def _extract_balanced_json_span(text: str) -> str | None:
    """Best-effort extraction of the first balanced top-level JSON object/array."""
    if not text:
        return None

    starts = []
    first_obj = text.find("{")
    first_arr = text.find("[")
    if first_obj != -1:
        starts.append((first_obj, "{", "}"))
    if first_arr != -1:
        starts.append((first_arr, "[", "]"))
    if not starts:
        return None

    start_idx, open_ch, close_ch = min(starts, key=lambda x: x[0])
    depth = 0
    in_string = False
    escape = False
    for i in range(start_idx, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start_idx:i + 1]
    return None


def _structured_text_candidates(raw_text: str) -> list[str]:
    text = (raw_text or "").strip()
    if not text:
        return []

    candidates: list[str] = []
    fenced = _extract_fenced_block(text)
    if fenced:
        candidates.append(fenced)

    candidates.append(text)

    balanced = _extract_balanced_json_span(text)
    if balanced:
        candidates.append(balanced)

    # Remove leading "json" token some models emit before the object.
    if text.lower().startswith("json"):
        trimmed = text[4:].lstrip(": \n\r\t")
        if trimmed:
            candidates.append(trimmed)
            balanced_trimmed = _extract_balanced_json_span(trimmed)
            if balanced_trimmed:
                candidates.append(balanced_trimmed)

    # Deduplicate while preserving order.
    seen = set()
    unique: list[str] = []
    for candidate in candidates:
        c = candidate.strip()
        if not c or c in seen:
            continue
        seen.add(c)
        unique.append(c)
    return unique

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

    def _chat_completion_kwargs(self, *, temperature: float | None) -> dict:
        """Build provider/model-compatible kwargs for chat completions."""
        model_name = (self.model_name or "").lower()
        # GPT-5 family rejects non-default temperature values in some OpenAI endpoints.
        if model_name.startswith("gpt-5"):
            return {}
        if temperature is None:
            return {}
        return {"temperature": temperature}

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

        attempt_prompts = [
            augmented_system_prompt,
            (
                f"{augmented_system_prompt}\n\n"
                "RETRY INSTRUCTIONS: Your previous response was invalid or incomplete. "
                "Return ONLY a single JSON object/array matching the schema. "
                "Do not add any prose, headings, markdown fences, or explanations."
            ),
        ]

        last_error: Exception | None = None
        for attempt_idx, system_prompt_attempt in enumerate(attempt_prompts, start=1):
            try:
                logger.info(
                    "Issuing structured request to model %s (attempt %s/%s)...",
                    self.model_name,
                    attempt_idx,
                    len(attempt_prompts),
                )
                response = await self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": system_prompt_attempt},
                        {"role": "user", "content": user_prompt}
                    ],
                    # Some providers/free models fail on response_format json mode; prompt-enforce JSON instead.
                    **self._chat_completion_kwargs(
                        temperature=0 if attempt_idx > 1 else 0.2
                    ),
                )
                logger.info(
                    "Successfully received structured response from %s (attempt %s).",
                    self.model_name,
                    attempt_idx,
                )

                if getattr(response, "choices", None) is None:
                    logger.error(
                        "Received invalid response structure from %s: %s",
                        self.model_name,
                        response,
                    )
                    raise ValueError(
                        f"Provider {self.model_name} returned an invalid response. Try a different model in .env."
                    )

                if len(response.choices) == 0:
                    logger.error("Received 0 choices from %s: %s", self.model_name, response)
                    raise ValueError(
                        f"Provider {self.model_name} returned no output. Try again or change model."
                    )

                text_response = response.choices[0].message.content or ""

                parse_candidates = _structured_text_candidates(text_response)
                if not parse_candidates:
                    raise ValueError("Model returned empty content for structured response")
                parse_errors: list[str] = []
                for candidate in parse_candidates:
                    try:
                        parsed_data = json.loads(candidate, strict=False)
                        return response_schema.model_validate(parsed_data)
                    except (json.JSONDecodeError, ValidationError, ValueError) as candidate_error:
                        parse_errors.append(str(candidate_error))
                        continue
                raise ValueError(
                    "Unable to parse structured response after candidate extraction: "
                    + " | ".join(parse_errors[:3])
                )

            except (json.JSONDecodeError, ValidationError, ValueError) as e:
                last_error = e
                if attempt_idx < len(attempt_prompts):
                    logger.warning(
                        "Structured parsing failed for %s on attempt %s/%s: %s. Retrying...",
                        self.model_name,
                        attempt_idx,
                        len(attempt_prompts),
                        e,
                    )
                    continue
                logger.error("Error parsing structured LLM response from %s: %s", self.model_name, e)
                raise
            except Exception as e:
                logger.error(f"Error calling LLM provider or parsing response: {e}")
                raise

        # Defensive fallback (should be unreachable because loop either returns or raises).
        if last_error:
            raise last_error
        raise RuntimeError("Structured generation failed without a captured error")

    async def generate_text(self, system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> str:
        """
        Generate plain text content (used for per-file code generation to avoid giant JSON payloads).
        Returns stripped text and removes markdown code fences if the model wraps the response.
        """
        last_error: Exception | None = None
        prompts = [
            system_prompt,
            (
                f"{system_prompt}\n\n"
                "RETRY INSTRUCTIONS: Return only the final file contents with no markdown fences "
                "and no explanation."
            ),
        ]
        for attempt_idx, system_prompt_attempt in enumerate(prompts, start=1):
            try:
                logger.info(
                    "Issuing text request to model %s (attempt %s/%s)...",
                    self.model_name,
                    attempt_idx,
                    len(prompts),
                )
                response = await self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": system_prompt_attempt},
                        {"role": "user", "content": user_prompt},
                    ],
                    **self._chat_completion_kwargs(
                        temperature=0 if attempt_idx > 1 else temperature
                    ),
                )
                if not getattr(response, "choices", None):
                    raise ValueError("Provider returned no output")
                text_response = (response.choices[0].message.content or "").strip()
                text_response = _strip_code_fences(text_response)
                if not text_response:
                    raise ValueError("Model returned empty content")
                logger.info(
                    "Successfully received text response from %s (attempt %s).",
                    self.model_name,
                    attempt_idx,
                )
                return text_response
            except Exception as e:
                last_error = e
                if attempt_idx < len(prompts):
                    logger.warning(
                        "Text generation failed for %s on attempt %s/%s: %s. Retrying...",
                        self.model_name,
                        attempt_idx,
                        len(prompts),
                        e,
                    )
                    continue
                logger.error("Error generating text response from %s: %s", self.model_name, e)
                raise

        if last_error:
            raise last_error
        raise RuntimeError("Text generation failed without a captured error")
