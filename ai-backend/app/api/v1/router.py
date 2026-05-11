from fastapi import APIRouter

from app.api.v1.endpoints import swarm

api_router = APIRouter()
api_router.include_router(swarm.router, tags=["swarm"])
