import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.swarm_service import init_swarm_graph

    pg_uri = settings.langgraph_postgres_uri()
    if pg_uri:
        from psycopg_pool import AsyncConnectionPool
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        logger.info("Initializing LangGraph AsyncPostgresSaver with connection pool for swarm checkpoints")
        # Use a pool so idle/dropped SSL connections (Neon, Supabase, RDS) are
        # automatically recycled rather than crashing on the first request after
        # the cloud provider closes the stale socket.
        pool = AsyncConnectionPool(
            conninfo=pg_uri,
            min_size=1,
            max_size=10,
            # Validate connection before handing it out – catches stale sockets.
            kwargs={"autocommit": True},
            open=False,
        )
        await pool.open()
        try:
            checkpointer = AsyncPostgresSaver(pool)
            await checkpointer.setup()
            init_swarm_graph(checkpointer)
            yield
        finally:
            await pool.close()
    else:
        from langgraph.checkpoint.memory import InMemorySaver

        logger.warning(
            "DATABASE_URL is SQLite or unset for Postgres — using InMemorySaver for swarm checkpoints "
            "(thread state is not persisted across process restarts). "
            "Set DATABASE_URL to postgresql://... for Postgres-backed short-term memory."
        )
        init_swarm_graph(InMemorySaver())
        yield


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @application.get("/", tags=["root"])
    async def root() -> dict[str, str]:
        return {"message": f"{settings.APP_NAME} is running"}

    return application


app = create_application()
