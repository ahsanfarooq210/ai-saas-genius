from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "AI Backend"
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DATABASE_URL: str = Field(
        default="sqlite:///./app.db",
        description="SQLAlchemy URL. For LangGraph Postgres checkpoints use Postgres and `langgraph_postgres_uri`.",
    )
    JWT_SECRET_KEY: str = "change_me_in_production"
    JWT_REFRESH_SECRET_KEY: str = "change_me_in_production_refresh"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 10080
    GOOGLE_API_KEY: Optional[str] = None
    UPLOAD_STORAGE_DIR: str = "uploads"
    # If unset, non-localhost hosts get sslmode=require (Neon/Supabase/RDS). Override with "disable" for local Docker, etc.
    LANGGRAPH_POSTGRES_SSLMODE: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def langgraph_postgres_uri(self) -> Optional[str]:
        """
        Connection string for LangGraph Postgres checkpointer (short-term / thread memory).
        Returns None when `DATABASE_URL` is SQLite — callers should use `InMemorySaver` instead.

        Adds `sslmode` for remote hosts when missing — fixes psycopg SSL errors like
        "SSL connection has been closed unexpectedly" against cloud Postgres.
        """
        u = (self.DATABASE_URL or "").strip()
        if u.startswith("sqlite"):
            return None
        for prefix in (
            "postgresql+psycopg2://",
            "postgresql+asyncpg://",
            "postgresql+psycopg://",
        ):
            if u.startswith(prefix):
                u = "postgresql://" + u.removeprefix(prefix)
                break
        else:
            if u.startswith("postgres://"):
                u = "postgresql://" + u.removeprefix("postgres://")

        return _with_langgraph_postgres_params(
            u,
            sslmode_override=self.LANGGRAPH_POSTGRES_SSLMODE,
        )


def _is_local_postgres_host(hostname: Optional[str]) -> bool:
    if not hostname:
        return True
    h = hostname.lower()
    return h in ("localhost", "127.0.0.1", "::1")


def _with_langgraph_postgres_params(uri: str, *, sslmode_override: Optional[str]) -> str:
    """Merge libpq query params for LangGraph/psycopg (SSL, keepalives)."""
    parsed = urlparse(uri)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))

    if sslmode_override is not None:
        if sslmode_override.strip() == "":
            pass  # explicit: do not set sslmode
        else:
            q["sslmode"] = sslmode_override.strip()
    elif "sslmode" not in q and not _is_local_postgres_host(parsed.hostname):
        q["sslmode"] = "require"

    # Reduce idle disconnects on managed Postgres
    if not _is_local_postgres_host(parsed.hostname):
        q.setdefault("keepalives", "1")
        q.setdefault("keepalives_idle", "30")

    new_query = urlencode(q)
    return urlunparse(parsed._replace(query=new_query))


settings = Settings()
