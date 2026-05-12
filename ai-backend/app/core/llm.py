"""Singleton OpenCode Go chat model (OpenAI-compatible LangChain client)."""

from __future__ import annotations

from threading import Lock
from typing import Optional

from langchain_openai import ChatOpenAI

from app.core.config import settings

_llm: Optional[ChatOpenAI] = None
_lock = Lock()


def get_chat_llm() -> ChatOpenAI:
    """
    Return a process-wide shared `ChatOpenAI` instance.

    Configure via `.env`: `OPENCODE_API_KEY`, and optionally
    `OPENCODE_BASE_URL`, `OPENCODE_MODEL`, `OPENCODE_TEMPERATURE`.
    """
    global _llm
    with _lock:
        if _llm is None:
            if not settings.OPENCODE_API_KEY:
                raise RuntimeError(
                    "OPENCODE_API_KEY is not set. Add it to your environment or .env file."
                )
            _llm = ChatOpenAI(
                model=settings.OPENCODE_MODEL,
                api_key=settings.OPENCODE_API_KEY,
                base_url=settings.OPENCODE_BASE_URL,
                temperature=settings.OPENCODE_TEMPERATURE,
            )
        return _llm
