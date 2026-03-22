"""Compile-once and run helpers for the LangGraph swarm (with optional Postgres checkpointer)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.agent.agent import build_swarm_graph
from app.agent.state.global_swarm_state import GlobalSwarmState, initial_state

logger = logging.getLogger(__name__)

_graph = None

# Supervisor + workers can take many steps; default LangGraph limit is low.
_RECURSION_LIMIT = 120


def unpack_astream_item(item: Any) -> tuple[str, Any]:
    """
    Normalize LangGraph `astream` yields when `stream_mode` is a sequence.
    With `subgraphs=True`, items are `(namespace, mode, chunk)`; otherwise `(mode, chunk)`.
    """
    if isinstance(item, tuple):
        if len(item) == 3:
            return item[1], item[2]
        if len(item) == 2:
            return item[0], item[1]
    raise ValueError(f"Unexpected astream item shape: {type(item)!r}")


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


async def astream_swarm(
    *,
    thread_id: str,
    task_requirement: str | None = None,
    user_id: str | None = None,
):
    """
    Stream LangGraph `updates` and `custom` modes (see `astream(..., stream_mode=[...])`).
    With `task_requirement`, starts or resumes a run with fresh input for that thread;
    with `task_requirement` omitted, passes `None` to resume from checkpoint only.
    """
    graph = get_swarm_graph()
    config = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": _RECURSION_LIMIT,
    }
    if task_requirement:
        inp = initial_state(thread_id=thread_id, requirement=task_requirement, user_id=user_id)
    else:
        inp = None

    async for item in graph.astream(
        inp,
        config=config,
        stream_mode=["updates", "custom"],
        subgraphs=True,
    ):
        yield item


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
