import re

from app.agent.artifacts import ProjectCharter, SystemArchitecture
from app.agent.base import BaseAgent
from app.agent.prompts.architecture import ARCHITECTURE_SYSTEM_PROMPT


class ArchitectureAgent(BaseAgent[ProjectCharter, SystemArchitecture]):
    """
    Agent responsible for designing the system architecture based on a ProjectCharter.
    """

    @staticmethod
    def _normalize_mermaid(code: str) -> str:
        text = (code or "").strip()
        if not text:
            return "flowchart TD\n  API[\"API\"]"

        # Strip markdown fences / BOM / zero-width chars.
        fenced = re.match(r"```(?:mermaid)?\s*([\s\S]*?)\s*```$", text, flags=re.IGNORECASE)
        if fenced:
            text = fenced.group(1).strip()
        text = re.sub(r"^[\uFEFF\u200B-\u200D]+", "", text)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln.rstrip() for ln in text.split("\n")]
        if lines and lines[0].strip().lower() == "mermaid":
            lines = lines[1:]
        text = "\n".join(lines).strip()

        # Force top-down flowchart.
        text = re.sub(r"^\s*(flowchart|graph)\s+(LR|RL)\b", "flowchart TD", text, flags=re.IGNORECASE)
        if not re.match(r"^\s*(flowchart|graph)\s+\w+\b", text, flags=re.IGNORECASE):
            text = f"flowchart TD\n{text}"
        text = re.sub(r"^\s*graph\s+TD\b", "flowchart TD", text, flags=re.IGNORECASE)

        # Remove fragile note syntax.
        text = "\n".join(
            line for line in text.split("\n")
            if not re.match(r"^\s*note\s+(left|right)\s+of\b", line, flags=re.IGNORECASE)
        ).strip()

        # Rewrite dotted labeled edges to plain labeled arrows.
        text = re.sub(r"---\s*\|\s*([^|\n]+?)\s*\|\s*", lambda m: f" -->|{m.group(1).strip()}| ", text)

        # Expand ampersand shorthand declarations (A[...] & B[...]) into one per line.
        expanded: list[str] = []
        for line in text.split("\n"):
            if "&" in line and re.search(r"[\[\(\{]", line):
                indent = re.match(r"^\s*", line).group(0)
                parts = [p.strip() for p in line.split("&") if p.strip()]
                if len(parts) > 1:
                    expanded.extend(f"{indent}{p}" for p in parts)
                    continue
            expanded.append(line)
        text = "\n".join(expanded)

        # Quote standard square-bracket labels with spaces/punctuation.
        def _quote_square_label(match: re.Match) -> str:
            node_id = match.group(1)
            label = match.group(2).strip()
            # Leave already-quoted or shape-like labels alone.
            if label.startswith('"') and label.endswith('"'):
                return match.group(0)
            if label.startswith("(") or label.startswith("{") or label.startswith("<"):
                return match.group(0)
            if re.search(r"[\s/:,()\-]", label):
                safe = label.replace('"', '\\"')
                return f'{node_id}["{safe}"]'
            return match.group(0)

        text = re.sub(r"\b([A-Za-z][\w-]*)\[(?!\()([^\]\n]+)\]", _quote_square_label, text)

        # Replace arrows inside labels which can confuse Mermaid tokenization.
        text = re.sub(r"\|([^|\n]*)\|", lambda m: "|" + m.group(1).replace("->", "→").replace("<-", "←") + "|", text)

        return text.strip()

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

        architecture.mermaid_diagram = self._normalize_mermaid(architecture.mermaid_diagram)
        return architecture
