import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_current_user
from app.schemas.agent import AgentGraphMermaidResponse, SwarmRunResponse
from app.services.swarm_service import (
    get_agent_graph_mermaid,
    get_swarm_graph_png,
    iter_swarm_sse_events,
    run_swarm_request,
)

logger = logging.getLogger(__name__)

router = APIRouter()


router.get(
    "/graph/mermaid",
    response_model=AgentGraphMermaidResponse,
    summary="Swarm graph as Mermaid text",
    description=(
        "Returns the LangGraph topology as Mermaid source (same primitive as "
        "`compiled.get_graph().draw_mermaid()` in the LangGraph / LangChain Graph API). "
        "Use `xray=true` to expand nested subgraphs when supported."
    ),
    dependencies=[Depends(get_current_user)],
)(get_agent_graph_mermaid)


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
    dependencies=[Depends(get_current_user)],
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


router.post(
    "/run",
    response_model=SwarmRunResponse,
    status_code=status.HTTP_200_OK,
    summary="Run architecture swarm",
    description=(
        "Executes the full supervisor graph (architect → docs → scalability → security) "
        "until completion or iteration limit. This call may take a long time and invokes LLMs."
    ),
    dependencies=[Depends(get_current_user)],
)(run_swarm_request)


@router.get(
    "/stream/{thread_id}",
    summary="Stream swarm state updates and custom progress (SSE)",
    description=(
        "Server-Sent Events: `event: state_update` carries LangGraph `updates` chunks; "
        "`event: progress` carries `get_stream_writer()` payloads from nodes. "
        "Pass `task_requirement` to start a new run for this `thread_id`; omit it to resume "
        "from the last checkpoint for that thread only."
    ),
    dependencies=[Depends(get_current_user)],
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
    return EventSourceResponse(
        iter_swarm_sse_events(
            thread_id=thread_id,
            task_requirement=task_requirement,
            user_id=user_id,
            is_disconnected=request.is_disconnected,
        )
    )
