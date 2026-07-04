from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent.storage.file_store import artifact_store
from app.agent.graphs.supervisor_graph import build_supervisor_graph
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.langfuse import shutdown_langfuse
from app.db.checkpointer import postgres_checkpointer
from app.db.migration_check import validate_required_app_tables
from app.db.session import engine
from app.middleware.auth import JWTAuthMiddleware
from app.services.swarm_graph_service import SwarmGraphService


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_required_app_tables(engine)
    artifact_store.configure_from_settings(settings)
    async with postgres_checkpointer() as checkpointer:
        graph = build_supervisor_graph(checkpointer)
        app.state.swarm_graph_service = SwarmGraphService(graph)
        try:
            yield
        finally:
            shutdown_langfuse()


app = FastAPI(lifespan=lifespan)
# Added first so it's outermost: CORS must handle preflight OPTIONS requests
# before JWTAuthMiddleware ever sees them. allow_credentials=True requires an
# explicit origin list (no "*") for the browser to accept cross-origin cookies.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)
app.add_middleware(JWTAuthMiddleware)
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
