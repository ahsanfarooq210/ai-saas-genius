"""Custom LangGraph stream payloads (use with astream(..., stream_mode=[..., \"custom\"])."""

from __future__ import annotations

from typing import Any, Mapping


def emit_custom_event(payload: Mapping[str, Any]) -> None:
    try:
        from langgraph.config import get_stream_writer

        writer = get_stream_writer()
        if writer is not None:
            writer(dict(payload))
    except Exception:
        pass
