"""Normalize LangChain chat model output: Gemini (and others) may set `content` to str or a list of blocks."""

from __future__ import annotations

from typing import Any


def message_content_to_str(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if "text" in block:
                    parts.append(str(block["text"]))
                elif isinstance(block.get("content"), str):
                    parts.append(block["content"])
                elif isinstance(block.get("content"), list):
                    parts.append(message_content_to_str(block["content"]))
                else:
                    parts.append(str(block))
            else:
                t = getattr(block, "text", None)
                parts.append(str(t) if t is not None else str(block))
        return "".join(parts)
    return str(content)
