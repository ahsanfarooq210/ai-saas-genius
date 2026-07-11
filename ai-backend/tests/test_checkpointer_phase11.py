"""Phase 11 Postgres checkpointer configuration."""

import pytest

from app.core.config import Settings
from app.db.checkpointer import (
    PHASE_11_POSTGRES_REQUIRED,
    require_langgraph_postgres_uri,
)


def _settings(database_url: str, *, sslmode: str | None = None) -> Settings:
    return Settings(
        COOKIE_SECURE=False,
        DATABASE_URL=database_url,
        LANGGRAPH_POSTGRES_SSLMODE=sslmode,
        _env_file=None,
    )


def test_sqlite_database_url_is_rejected_for_phase11_runtime() -> None:
    settings = _settings("sqlite:///./app.db")

    with pytest.raises(RuntimeError, match=PHASE_11_POSTGRES_REQUIRED):
        require_langgraph_postgres_uri(settings)


def test_postgres_sqlalchemy_driver_url_is_normalized_for_langgraph() -> None:
    settings = _settings("postgresql+psycopg2://user:pass@localhost:5432/app")

    assert (
        require_langgraph_postgres_uri(settings)
        == "postgresql://user:pass@localhost:5432/app"
    )


def test_remote_postgres_url_gets_required_ssl_and_keepalive_params() -> None:
    settings = _settings("postgresql+psycopg://user:pass@db.example.com/app")

    uri = require_langgraph_postgres_uri(settings)

    assert uri.startswith("postgresql://user:pass@db.example.com/app?")
    assert "sslmode=require" in uri
    assert "keepalives=1" in uri
    assert "keepalives_idle=30" in uri


def test_explicit_langgraph_sslmode_override_is_preserved() -> None:
    settings = _settings(
        "postgres://user:pass@db.example.com/app",
        sslmode="disable",
    )

    uri = require_langgraph_postgres_uri(settings)

    assert uri.startswith("postgresql://user:pass@db.example.com/app?")
    assert "sslmode=disable" in uri
