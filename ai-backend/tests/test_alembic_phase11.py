"""Phase 11 app tables and Alembic schema filtering."""

from types import SimpleNamespace

from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.db.alembic_filters import include_object
from app.db.base import Base
from app.db.migration_check import (
    REQUIRED_APP_TABLES,
    REQUIRED_TABLES_MISSING,
    validate_required_app_tables,
)


def test_swarm_persistence_tables_are_registered_with_base_metadata() -> None:
    assert "sessions" in Base.metadata.tables
    assert "debate_logs" in Base.metadata.tables
    assert "session_artifacts" in Base.metadata.tables


def test_alembic_excludes_langgraph_schema_objects() -> None:
    obj = SimpleNamespace(schema="langgraph")

    assert include_object(obj, "checkpoints", "table", False, None) is False


def test_alembic_includes_public_schema_objects() -> None:
    obj = SimpleNamespace(schema=None)

    assert include_object(obj, "sessions", "table", False, None) is True


def test_phase11_migration_chains_after_existing_users_revision() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))

    existing_users_revision = script.get_revision("7ff644cccf7c")
    phase11_revision = script.get_revision("001_initial_swarm_persistence")
    artifact_revision = script.get_revision("002_add_session_artifacts")
    graph_state_revision = script.get_revision("003_add_session_graph_state")

    assert existing_users_revision is not None
    assert phase11_revision.down_revision == "7ff644cccf7c"
    assert artifact_revision.down_revision == "001_initial_swarm_persistence"
    assert graph_state_revision.down_revision == "002_add_session_artifacts"


def test_required_app_table_validation_reports_missing_tables() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    with pytest.raises(RuntimeError, match=REQUIRED_TABLES_MISSING):
        validate_required_app_tables(engine)


def test_required_app_table_validation_passes_when_tables_exist() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    validate_required_app_tables(engine)
    assert REQUIRED_APP_TABLES == frozenset(
        {"users", "sessions", "debate_logs", "session_artifacts"}
    )
