import asyncio

from fastapi import APIRouter

from app.api.deps import SwarmGraphServiceDep
from app.schemas.swarm import SwarmRunRequest, SwarmRunResponse

router = APIRouter(prefix="/swarm")


@router.post("/run", response_model=SwarmRunResponse)
async def run_swarm_graph(
    body: SwarmRunRequest,
    service: SwarmGraphServiceDep,
) -> SwarmRunResponse:
    result = await asyncio.to_thread(service.run, body.task_requirement)
    return SwarmRunResponse.model_validate(result)
