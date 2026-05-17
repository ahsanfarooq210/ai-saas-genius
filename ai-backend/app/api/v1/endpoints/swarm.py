import asyncio

from fastapi import APIRouter

from app.api.deps import SwarmGraphServiceDep
from app.schemas.swarm import (
    SwarmCheckpointResponse,
    SwarmResumeRequest,
    SwarmRunRequest,
    SwarmRunResponse,
)

router = APIRouter(prefix="/swarm")


@router.post("/run", response_model=SwarmRunResponse)
async def run_swarm_graph(
    body: SwarmRunRequest,
    service: SwarmGraphServiceDep,
) -> SwarmRunResponse:
    result = await asyncio.to_thread(
        service.run, body.task_requirement, body.thread_id
    )
    return SwarmRunResponse.model_validate(result)


@router.post("/resume", response_model=SwarmRunResponse)
async def resume_swarm_graph(
    body: SwarmResumeRequest,
    service: SwarmGraphServiceDep,
) -> SwarmRunResponse:
    result = await asyncio.to_thread(service.resume, body.thread_id)
    return SwarmRunResponse.model_validate(result)


@router.get("/state/{thread_id}", response_model=SwarmCheckpointResponse)
async def get_swarm_checkpoint(
    thread_id: str,
    service: SwarmGraphServiceDep,
) -> SwarmCheckpointResponse:
    snapshot = await asyncio.to_thread(service.get_checkpoint, thread_id)
    return SwarmCheckpointResponse.model_validate(snapshot)
