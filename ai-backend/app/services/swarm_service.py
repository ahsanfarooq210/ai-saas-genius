"""Compile-once and run helpers for the LangGraph swarm (with optional Postgres checkpointer)."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from fastapi import HTTPException, status

from app.agent.agent import build_swarm_graph
from app.agent.state.global_swarm_state import GlobalSwarmState, initial_state
from app.schemas.agent import AgentGraphMermaidResponse, SwarmRunRequest, SwarmRunResponse

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


async def run_swarm_request(payload: SwarmRunRequest) -> SwarmRunResponse:
    """HTTP-facing swarm run: executes the graph and returns the public response model."""
    try:
        state = await run_swarm(
            task_requirement=payload.task_requirement,
            thread_id=payload.thread_id,
            user_id=payload.user_id,
        )
    except Exception as exc:
        logger.exception("Swarm run failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Swarm execution failed. See server logs.",
        ) from exc
    return swarm_state_to_run_response(state)


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


def get_agent_graph_mermaid(*, xray: bool = False) -> AgentGraphMermaidResponse:
    """API response: swarm graph as Mermaid text (logs and maps failures to HTTP 500)."""
    try:
        text = get_swarm_graph_mermaid(xray=xray)
    except Exception as exc:
        logger.exception("Failed to build Mermaid for swarm graph")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not generate Mermaid diagram.",
        ) from exc
    return AgentGraphMermaidResponse(mermaid=text)


def get_swarm_graph_png(*, xray: bool = False) -> bytes:
    """PNG bytes for the graph diagram (requires a working renderer; see LangGraph docs)."""
    return _get_structure_graph(xray=xray).draw_mermaid_png()


def swarm_state_to_run_response(state: GlobalSwarmState) -> SwarmRunResponse:
    """Map final graph state to the public HTTP response model."""
    return SwarmRunResponse(
        thread_id=state["thread_id"],
        user_id=state.get("user_id"),
        task_requirement=state["task_requirement"],
        iteration_count=state["iteration_count"],
        docs_complete=state["docs_complete"],
        next_agent=str(state.get("next_agent", "")),
        current_architecture_mermaid=state["current_architecture_mermaid"],
        architecture_json=state["architecture_json"],
        component_list=state["component_list"],
        complexity_score=state["complexity_score"],
        diagram_plan=state["diagram_plan"],
        doc_plan=state["doc_plan"],
        generated_diagrams=[dict(d) for d in state["generated_diagrams"]],
        generated_docs=[dict(d) for d in state["generated_docs"]],
        scalability_feedback=state["scalability_feedback"],
        security_feedback=state["security_feedback"],
        current_stage=state.get("current_stage", ""),
        current_task=state.get("current_task", ""),
        progress_message=state.get("progress_message", ""),
        active_item_type=state.get("active_item_type", ""),
        active_item_name=state.get("active_item_name", ""),
        completed_diagram_count=state.get("completed_diagram_count", 0),
        completed_doc_count=state.get("completed_doc_count", 0),
        total_diagram_count=state.get("total_diagram_count", 0),
        total_doc_count=state.get("total_doc_count", 0),
    )


async def iter_swarm_sse_events(
    *,
    thread_id: str,
    task_requirement: str | None = None,
    user_id: str | None = None,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[dict[str, str]]:
    """
    Async iterator of SSE payloads for `EventSourceResponse` (`event` + JSON `data`).
    """
    try:
        async for item in astream_swarm(
            thread_id=thread_id,
            task_requirement=task_requirement,
            user_id=user_id,
        ):
            if is_disconnected is not None and await is_disconnected():
                break
            mode, chunk = unpack_astream_item(item)
            if mode == "updates":
                yield {
                    "event": "state_update",
                    "data": json.dumps(chunk, default=str),
                }
            elif mode == "custom":
                yield {
                    "event": "progress",
                    "data": json.dumps(chunk, default=str),
                }
    except Exception as exc:
        logger.exception("Swarm stream failed")
        yield {
            "event": "error",
            "data": json.dumps({"message": str(exc)}, default=str),
        }
