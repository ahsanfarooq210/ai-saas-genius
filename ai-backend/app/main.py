from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.config import settings


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    application.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @application.get("/", tags=["root"])
    async def root() -> dict[str, str]:
        return {"message": f"{settings.APP_NAME} is running"}

    return application


app = create_application()
