from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.services.swarm_graph_service import SwarmGraphService


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.swarm_graph_service = SwarmGraphService()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
