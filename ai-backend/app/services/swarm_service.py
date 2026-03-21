"""Compile-once and run helpers for the LangGraph swarm (with optional Postgres checkpointer)."""

from __future__ import annotations

import logging
import uuid

from app.agent.agent import build_swarm_graph
from app.agent.state.global_swarm_state import GlobalSwarmState, initial_state

logger = logging.getLogger(__name__)

_graph = None

# Supervisor + workers can take many steps; default LangGraph limit is low.
_RECURSION_LIMIT = 120


def init_swarm_graph(checkpointer) -> None:
    """Called once at app startup after the checkpointer is ready (see FastAPI lifespan)."""
    global _graph
    _graph = build_swarm_graph(checkpointer=checkpointer)


def get_swarm_graph():
    if _graph is None:
        raise RuntimeError(
            "Swarm graph is not initialized — ensure FastAPI lifespan ran (Postgres or InMemory checkpointer)."
        )
    return _graph


async def run_swarm(
    *,
    task_requirement: str,
    thread_id: str | None,
    user_id: str | None,
) -> GlobalSwarmState:
    tid = thread_id or str(uuid.uuid4())
    graph = get_swarm_graph()
    state = initial_state(thread_id=tid, requirement=task_requirement, user_id=user_id)
    # Short-term / thread persistence (LangGraph persistence docs)
    config = {
        "configurable": {"thread_id": tid},
        "recursion_limit": _RECURSION_LIMIT,
    }
    result = await graph.ainvoke(state, config=config)
    return result  # type: ignore[return-value]


def _get_structure_graph(*, xray: bool):
    """LangGraph/LangChain `Graph` used for `draw_mermaid` / `draw_mermaid_png` (see Graph API docs)."""
    app = get_swarm_graph()
    try:
        return app.get_graph(xray=xray)
    except TypeError:
        return app.get_graph()


def get_swarm_graph_mermaid(*, xray: bool = False) -> str:
    """Mermaid source for the compiled swarm graph topology."""
    return _get_structure_graph(xray=xray).draw_mermaid()


def get_swarm_graph_png(*, xray: bool = False) -> bytes:
    """PNG bytes for the graph diagram (requires a working renderer; see LangGraph docs)."""
    return _get_structure_graph(xray=xray).draw_mermaid_png()
