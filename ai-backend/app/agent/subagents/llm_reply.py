"""Turn chat completion text into a dict (handles ```json fences and leading prose)."""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def assistant_text(message: Any) -> str:
    """LangChain AIMessage.content as a single string (str or list of blocks)."""
    content = getattr(message, "content", message)
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


def json_object_from_text(text: str) -> dict[str, Any]:
    """Parse the first top-level JSON object from the model reply."""
    s = text.strip()
    m = _FENCE.search(s)
    if m:
        s = m.group(1).strip()
    start = s.find("{")
    if start < 0:
        raise ValueError("No JSON object in reply.")
    data, _ = json.JSONDecoder().raw_decode(s[start:])
    if not isinstance(data, dict):
        raise ValueError("Top-level JSON must be an object.")
    return data
