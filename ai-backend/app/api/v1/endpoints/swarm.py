import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import SwarmGraphServiceDep
from app.db.session import get_db
from app.schemas.swarm import (
    SwarmCheckpointResponse,
    SwarmGraphListResponse,
    SwarmGraphMermaidResponse,
    SwarmReviseRequest,
    SwarmRevisionListResponse,
    SwarmRevisionResponse,
    SwarmResumeRequest,
    SwarmRunRequest,
    SwarmRunResponse,
    SwarmSessionResponse,
)
from app.services.swarm_graph_service import (
    SwarmSessionBusyError,
    UnknownSwarmSessionError,
)

router = APIRouter(prefix="/swarm")


def _sse_message(event_name: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event_name}\ndata: {payload}\n\n"


async def _sse_stream(
    events: AsyncIterator[dict[str, Any]],
) -> AsyncIterator[str]:
    async for envelope in events:
        event_name = str(envelope.get("event") or "progress")
        data = envelope.get("data")
        if not isinstance(data, dict):
            data = {}
        yield _sse_message(event_name, data)


def _streaming_response(events: AsyncIterator[dict[str, Any]]) -> StreamingResponse:
    return StreamingResponse(
        _sse_stream(events),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/run", response_model=SwarmRunResponse)
async def run_swarm_graph(
    body: SwarmRunRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRunResponse:
    result = await service.run(body.task_requirement, body.thread_id, db=db)
    return SwarmRunResponse.model_validate(result)


@router.post("/run/stream")
async def stream_swarm_graph(
    body: SwarmRunRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return _streaming_response(
        service.stream_run(body.task_requirement, body.thread_id, db=db)
    )


@router.post("/resume", response_model=SwarmRunResponse)
async def resume_swarm_graph(
    body: SwarmResumeRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRunResponse:
    result = await service.resume(body.thread_id, db=db)
    return SwarmRunResponse.model_validate(result)


@router.post("/resume/stream")
async def stream_resume_swarm_graph(
    body: SwarmResumeRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return _streaming_response(service.stream_resume(body.thread_id, db=db))


@router.post("/revise", response_model=SwarmRunResponse)
async def revise_swarm_graph(
    body: SwarmReviseRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRunResponse:
    try:
        result = await service.revise(body.instruction, body.thread_id, db=db)
    except UnknownSwarmSessionError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown thread_id: {body.thread_id}",
        ) from None
    except SwarmSessionBusyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Thread is already running: {body.thread_id}",
        ) from None
    return SwarmRunResponse.model_validate(result)


@router.post("/revise/stream")
async def stream_revise_swarm_graph(
    body: SwarmReviseRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        events = await service.stream_revise(
            body.instruction,
            body.thread_id,
            db=db,
        )
    except UnknownSwarmSessionError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown thread_id: {body.thread_id}",
        ) from None
    except SwarmSessionBusyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Thread is already running: {body.thread_id}",
        ) from None
    return _streaming_response(events)


@router.get("/state/{thread_id}", response_model=SwarmCheckpointResponse)
async def get_swarm_checkpoint(
    thread_id: str,
    service: SwarmGraphServiceDep,
) -> SwarmCheckpointResponse:
    snapshot = await service.get_checkpoint(thread_id)
    return SwarmCheckpointResponse.model_validate(snapshot)


@router.get("/sessions/{thread_id}", response_model=SwarmSessionResponse)
async def get_swarm_session(
    thread_id: str,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmSessionResponse:
    try:
        session_payload = await run_in_threadpool(service.get_session, thread_id, db)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown thread_id: {thread_id}",
        ) from None
    return SwarmSessionResponse.model_validate(session_payload)


@router.get(
    "/sessions/{thread_id}/revisions",
    response_model=SwarmRevisionListResponse,
)
async def list_swarm_revisions(
    thread_id: str,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRevisionListResponse:
    try:
        payload = await run_in_threadpool(service.list_revisions, thread_id, db)
    except UnknownSwarmSessionError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown thread_id: {thread_id}",
        ) from None
    return SwarmRevisionListResponse.model_validate(payload)


@router.get(
    "/sessions/{thread_id}/revisions/{revision_number}",
    response_model=SwarmRevisionResponse,
)
async def get_swarm_revision(
    thread_id: str,
    revision_number: int,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRevisionResponse:
    try:
        payload = await run_in_threadpool(
            service.get_revision,
            thread_id,
            revision_number,
            db,
        )
    except UnknownSwarmSessionError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Unknown revision {revision_number} for thread_id: {thread_id}"
            ),
        ) from None
    return SwarmRevisionResponse.model_validate(payload)


@router.get("/graphs", response_model=SwarmGraphListResponse)
async def list_swarm_graphs(
    service: SwarmGraphServiceDep,
) -> SwarmGraphListResponse:
    graphs = service.list_graphs()
    return SwarmGraphListResponse(graphs=graphs)


@router.get("/graphs/{graph_id}/mermaid", response_model=SwarmGraphMermaidResponse)
async def get_swarm_graph_mermaid(
    graph_id: str,
    service: SwarmGraphServiceDep,
    xray: bool = Query(
        False,
        description="Expand nested sub-graphs in the diagram (supervisor graph only)",
    ),
) -> SwarmGraphMermaidResponse:
    try:
        result = service.get_graph_mermaid(graph_id, xray=xray)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown graph_id: {graph_id}",
        ) from None
    return SwarmGraphMermaidResponse.model_validate(result)
