import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import Response
from sse_starlette.sse import EventSourceResponse

from app.schemas.agent import AgentGraphMermaidResponse, SwarmRunRequest, SwarmRunResponse
from app.services.swarm_service import (
    astream_swarm,
    get_swarm_graph_mermaid,
    get_swarm_graph_png,
    run_swarm,
    unpack_astream_item,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/graph/mermaid",
    response_model=AgentGraphMermaidResponse,
    summary="Swarm graph as Mermaid text",
    description=(
        "Returns the LangGraph topology as Mermaid source (same primitive as "
        "`compiled.get_graph().draw_mermaid()` in the LangGraph / LangChain Graph API). "
        "Use `xray=true` to expand nested subgraphs when supported."
    ),
)
async def get_agent_graph_mermaid(xray: bool = False) -> AgentGraphMermaidResponse:
    try:
        text = get_swarm_graph_mermaid(xray=xray)
    except Exception as exc:
        logger.exception("Failed to build Mermaid for swarm graph")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not generate Mermaid diagram.",
        ) from exc
    return AgentGraphMermaidResponse(mermaid=text)


@router.get(
    "/graph/image",
    response_class=Response,
    summary="Swarm graph as PNG image",
    description=(
        "Returns a PNG rendering of the graph (`get_graph().draw_mermaid_png()`). "
        "May require network access or optional system dependencies depending on LangGraph version."
    ),
    responses={
        200: {"content": {"image/png": {}}},
        503: {"description": "PNG rendering unavailable (renderer missing or failed)."},
    },
)
async def get_agent_graph_image(xray: bool = False) -> Response:
    try:
        png = get_swarm_graph_png(xray=xray)
    except Exception as exc:
        logger.warning("PNG graph render failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not render graph as PNG. Use GET /agent/graph/mermaid for Mermaid text "
                "and render with https://mermaid.live or your client."
            ),
        ) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": 'inline; filename="swarm-graph.png"',
        },
    )


@router.post(
    "/run",
    response_model=SwarmRunResponse,
    status_code=status.HTTP_200_OK,
    summary="Run architecture swarm",
    description=(
        "Executes the full supervisor graph (architect → docs → scalability → security) "
        "until completion or iteration limit. This call may take a long time and invokes LLMs."
    ),
)
async def run_swarm_endpoint(payload: SwarmRunRequest) -> SwarmRunResponse:
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


@router.get(
    "/stream/{thread_id}",
    summary="Stream swarm state updates and custom progress (SSE)",
    description=(
        "Server-Sent Events: `event: state_update` carries LangGraph `updates` chunks; "
        "`event: progress` carries `get_stream_writer()` payloads from nodes. "
        "Pass `task_requirement` to start a new run for this `thread_id`; omit it to resume "
        "from the last checkpoint for that thread only."
    ),
)
async def stream_swarm(
    thread_id: str,
    request: Request,
    task_requirement: str | None = Query(
        default=None,
        max_length=50_000,
        description="If set, invokes the graph with this requirement (same as POST /run).",
    ),
    user_id: str | None = Query(default=None, max_length=256),
) -> EventSourceResponse:
    async def generator():
        try:
            async for item in astream_swarm(
                thread_id=thread_id,
                task_requirement=task_requirement,
                user_id=user_id,
            ):
                if await request.is_disconnected():
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

    return EventSourceResponse(generator())
