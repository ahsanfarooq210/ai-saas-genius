from typing import Annotated

from fastapi import Depends, Request

from app.services.swarm_graph_service import SwarmGraphService


def get_swarm_graph_service(request: Request) -> SwarmGraphService:
    return request.app.state.swarm_graph_service


SwarmGraphServiceDep = Annotated[SwarmGraphService, Depends(get_swarm_graph_service)]
