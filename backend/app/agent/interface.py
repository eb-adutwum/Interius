import re
from typing import Literal

from pydantic import BaseModel, Field
from app.agent.base import BaseAgent
from app.core.config import settings

INTERFACE_SYSTEM_PROMPT = """
You are Interius, the chat interface and intent router for an API/backend code generation assistant.

Your job is to decide whether the user's latest message should trigger the full generation
pipeline or should be handled as normal conversation.

Choose `should_trigger_pipeline=true` only when the user is clearly asking to build/generate/modify
software artifacts (APIs, code, schemas, endpoints, architecture, tests, deployment configs, etc.)
and the request is actionable for the pipeline.

Choose `should_trigger_pipeline=false` for:
- greetings, thanks, acknowledgements
- questions asking for clarification or context only
- conversational responses that do not ask for generation work
- vague prompts that need a follow-up question before generation

Return a concise assistant reply:
- If no pipeline: directly answer or ask a clarifying question.
- If pipeline: acknowledge and say Interius is starting generation.
- Always speak as Interius (use the name "Interius" in the assistant reply).

If `should_trigger_pipeline=true`, provide `pipeline_prompt` as a cleaned version of the request suitable
for downstream agents. If false, set `pipeline_prompt` to null.
""".strip()


class InterfaceDecision(BaseModel):
    intent: Literal["pipeline_request", "context_question", "social", "clarification"]
    should_trigger_pipeline: bool
    assistant_reply: str = Field(
        ...,
        description="Short message to show the user before/without pipeline execution.",
    )
    pipeline_prompt: str | None = Field(
        default=None,
        description="Normalized prompt to pass to the orchestrator when pipeline should run.",
    )


class InterfaceAgent(BaseAgent[str, InterfaceDecision]):
    """Routes user messages to either chat response or the generation pipeline."""

    def __init__(self, model_name: str | None = None):
        super().__init__(
            model_name=model_name or settings.MODEL_INTERFACE,
            base_url=settings.INTERFACE_LLM_BASE_URL or None,
            api_key=settings.INTERFACE_LLM_API_KEY or None,
        )

    async def run(self, input_data: str) -> InterfaceDecision:
        text = (input_data or "").strip()

        heuristic = self._quick_non_pipeline(text)
        if heuristic:
            return heuristic

        if not text:
            return InterfaceDecision(
                intent="clarification",
                should_trigger_pipeline=False,
                assistant_reply="Tell me what you want to build or ask a question, and I can help from there.",
                pipeline_prompt=None,
            )

        decision = await self.llm.generate_structured(
            system_prompt=INTERFACE_SYSTEM_PROMPT,
            user_prompt=text,
            response_schema=InterfaceDecision,
        )
        return self._normalize_decision(text, decision)

    @staticmethod
    def _normalize_decision(original_prompt: str, decision: InterfaceDecision) -> InterfaceDecision:
        assistant_reply = (decision.assistant_reply or "").strip()
        if assistant_reply and "interius" not in assistant_reply.lower():
            assistant_reply = f"Interius: {assistant_reply}"

        if decision.should_trigger_pipeline:
            pipeline_prompt = (decision.pipeline_prompt or "").strip() or original_prompt.strip()
            return decision.model_copy(
                update={
                    "intent": "pipeline_request",
                    "assistant_reply": assistant_reply or "Interius is starting generation for your request.",
                    "pipeline_prompt": pipeline_prompt,
                }
            )

        return decision.model_copy(
            update={
                "assistant_reply": assistant_reply or "Interius is ready to help.",
                "pipeline_prompt": None,
            }
        )

    @staticmethod
    def _quick_non_pipeline(text: str) -> InterfaceDecision | None:
        if not text:
            return None

        normalized = re.sub(r"\s+", " ", text.lower()).strip()
        token_count = len(normalized.split())

        gratitude_tokens = {
            "thanks",
            "thank you",
            "thx",
            "ty",
            "appreciate it",
            "awesome thanks",
            "great thanks",
        }
        greeting_tokens = {
            "hi",
            "hello",
            "hey",
            "yo",
            "good morning",
            "good afternoon",
            "good evening",
        }

        if normalized in gratitude_tokens or normalized.rstrip("!.") in gratitude_tokens:
            return InterfaceDecision(
                intent="social",
                should_trigger_pipeline=False,
                assistant_reply="Interius: You're welcome. If you want, send the next feature or bug fix request and I'll route it correctly.",
                pipeline_prompt=None,
            )

        if token_count <= 4 and normalized.rstrip("!.?") in greeting_tokens:
            return InterfaceDecision(
                intent="social",
                should_trigger_pipeline=False,
                assistant_reply="Interius: Hi. Tell me what you need help with, and I'll either answer directly or start the pipeline if it's a build request.",
                pipeline_prompt=None,
            )

        return None
