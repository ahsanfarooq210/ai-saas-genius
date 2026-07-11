"""Runtime checks for app-managed database tables."""

from __future__ import annotations

from sqlalchemy import Engine, inspect

REQUIRED_APP_TABLES = frozenset(
    {"users", "sessions", "debate_logs", "session_artifacts", "swarm_revisions"}
)
REQUIRED_TABLES_MISSING = "Database schema is not migrated for Phase 11."


def validate_required_app_tables(engine: Engine) -> None:
    """Fail fast when app-managed tables are missing."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    missing = sorted(REQUIRED_APP_TABLES - existing)
    if missing:
        raise RuntimeError(
            f"{REQUIRED_TABLES_MISSING} Missing tables: {', '.join(missing)}. "
            "Run `PYTHONPATH=. alembic upgrade head` before starting the API."
        )
