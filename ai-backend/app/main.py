from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.agent.graphs.supervisor_graph import build_supervisor_graph
from app.api.v1.router import api_router
from app.db.checkpointer import postgres_checkpointer
from app.db.migration_check import validate_required_app_tables
from app.db.session import engine
from app.services.swarm_graph_service import SwarmGraphService


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_required_app_tables(engine)
    async with postgres_checkpointer() as checkpointer:
        graph = build_supervisor_graph(checkpointer)
        app.state.swarm_graph_service = SwarmGraphService(graph)
        yield


app = FastAPI(lifespan=lifespan)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
