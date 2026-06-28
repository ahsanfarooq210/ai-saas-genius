from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.api.v1.endpoints import auth, swarm

api_router = APIRouter()
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(
    swarm.router,
    tags=["swarm"],
    dependencies=[Depends(get_current_user)],
)
