from __future__ import annotations

import json
import re
from typing import Any

from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents._schema import ArchitectureDraft
from app.core.llm import get_chat_llm

_llm = get_chat_llm()

_SYSTEM_PROMPT = """\
You are a senior solutions architect.
Given a system design requirement, identify all the components needed,
describe each one clearly, and list their dependencies.

Rules:
- Be specific: name real components (e.g. "API Gateway", "Auth Service", "PostgreSQL")
- Keep component names concise — they become file names later
- For each component use the structured fields: name, description, relations (other component names it depends on; use [] if none)
- Aim for 3–12 components depending on the complexity of the system

Output format (critical):
- Your entire reply must be ONE JSON object only. No markdown headings, no "Here are…" preamble, no bullet lists outside JSON.
- Allowed: raw JSON, or a single ```json … ``` fenced block containing only that JSON.
- Shape: {"components":[{"name":"string","description":"string","relations":["OtherComponentName"]}]}
- "relations" is an array of strings; use [] if there are no dependencies.
- Order "components" most important first.
"""

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def _stringify_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "".join(parts)
    return str(content)


def _decode_top_level_json_object(text: str) -> dict[str, Any]:
    """Extract the first top-level JSON object from model text (handles fences and leading prose)."""
    s = text.strip()
    m = _JSON_FENCE.search(s)
    if m:
        s = m.group(1).strip()
    start = s.find("{")
    if start < 0:
        raise ValueError("Model reply contained no JSON object.")
    data, _ = json.JSONDecoder().raw_decode(s[start:])
    if not isinstance(data, dict):
        raise ValueError("Top-level JSON must be an object.")
    return data


class LeadArchitect:
    def draft_architecture_node(self, state: GlobalSwarmState) -> dict:
        print(f"\n[lead_architect] drafting architecture for: {state['task_requirement']!r}")

        ai_msg = _llm.invoke(
            [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": state["task_requirement"]},
            ]
        )
        raw = _stringify_message_content(ai_msg.content)
        try:
            payload = _decode_top_level_json_object(raw)
            result = ArchitectureDraft.model_validate(payload)
        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(
                "Lead architect model did not return parseable JSON. "
                "Ensure the chat API returns JSON or disable prose; first 500 chars:\n"
                f"{raw[:500]!r}"
            ) from e

        architecture_json = {
            item.name: {"description": item.description, "relations": list(item.relations)}
            for item in result.components
        }
        component_list = [item.name for item in result.components]

        return {
            "architecture_json": architecture_json,
            "component_list": component_list,
        }
