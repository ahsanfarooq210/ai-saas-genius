from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import SwarmGraphServiceDep
from app.db.session import get_db
from app.schemas.swarm import (
    SwarmCheckpointResponse,
    SwarmGraphListResponse,
    SwarmGraphMermaidResponse,
    SwarmResumeRequest,
    SwarmRunRequest,
    SwarmRunResponse,
    SwarmSessionResponse,
)

router = APIRouter(prefix="/swarm")


@router.post("/run", response_model=SwarmRunResponse)
async def run_swarm_graph(
    body: SwarmRunRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRunResponse:
    result = await service.run(body.task_requirement, body.thread_id, db=db)
    return SwarmRunResponse.model_validate(result)


@router.post("/resume", response_model=SwarmRunResponse)
async def resume_swarm_graph(
    body: SwarmResumeRequest,
    service: SwarmGraphServiceDep,
    db: Session = Depends(get_db),
) -> SwarmRunResponse:
    result = await service.resume(body.thread_id, db=db)
    return SwarmRunResponse.model_validate(result)


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
        session_payload = service.get_session(thread_id, db)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown thread_id: {thread_id}",
        ) from None
    return SwarmSessionResponse.model_validate(session_payload)


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
