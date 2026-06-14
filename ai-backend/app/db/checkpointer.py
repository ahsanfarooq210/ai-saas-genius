"""LangGraph Postgres checkpointer setup for Phase 11 runtime."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.core.config import Settings, settings

PHASE_11_POSTGRES_REQUIRED = (
    "Phase 11 requires a Postgres DATABASE_URL for LangGraph checkpoints."
)


def require_langgraph_postgres_uri(config: Settings = settings) -> str:
    """Return the normalized LangGraph Postgres URI or fail fast for SQLite."""
    uri = config.langgraph_postgres_uri()
    if uri is None or not uri.startswith("postgresql://"):
        raise RuntimeError(PHASE_11_POSTGRES_REQUIRED)
    return uri


@asynccontextmanager
async def postgres_checkpointer(
    config: Settings = settings,
) -> AsyncIterator[AsyncPostgresSaver]:
    """Open and initialize the LangGraph checkpointer for the app lifespan."""
    uri = require_langgraph_postgres_uri(config)
    async with AsyncPostgresSaver.from_conn_string(uri) as checkpointer:
        await checkpointer.setup()
        yield checkpointer
