"""Phase 11 app tables and Alembic schema filtering."""

from types import SimpleNamespace

from app.db.alembic_filters import include_object
from app.db.base import Base


def test_swarm_persistence_tables_are_registered_with_base_metadata() -> None:
    assert "sessions" in Base.metadata.tables
    assert "debate_logs" in Base.metadata.tables


def test_alembic_excludes_langgraph_schema_objects() -> None:
    obj = SimpleNamespace(schema="langgraph")

    assert include_object(obj, "checkpoints", "table", False, None) is False


def test_alembic_includes_public_schema_objects() -> None:
    obj = SimpleNamespace(schema=None)

    assert include_object(obj, "sessions", "table", False, None) is True
