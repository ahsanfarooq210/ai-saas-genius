"""Authenticated swarm-session listing and ownership boundaries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_swarm_graph_service
from app.api.v1.endpoints import swarm
from app.db.base import Base
from app.db.session import get_db
from app.models.swarm import SwarmSession
from app.models.user import User
from app.services.swarm_graph_service import SwarmGraphService


class NoopGraph:
    pass


def _client() -> tuple[TestClient, Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    user = User(
        email="owner@example.com",
        hashed_password="not-used",
        full_name="Owner",
    )
    other = User(
        email="other@example.com",
        hashed_password="not-used",
        full_name="Other",
    )
    db.add_all([user, other])
    db.commit()
    db.refresh(user)
    db.refresh(other)

    now = datetime.now(timezone.utc)
    db.add_all(
        [
            SwarmSession(
                thread_id="owner-new",
                user_id=user.id,
                requirement="New project",
                status="done",
                current_revision=2,
                created_at=now,
            ),
            SwarmSession(
                thread_id="owner-old",
                user_id=user.id,
                requirement="Old project",
                status="failed",
                created_at=now - timedelta(days=1),
            ),
            SwarmSession(
                thread_id="other-session",
                user_id=other.id,
                requirement="Private project",
                status="done",
                created_at=now + timedelta(days=1),
            ),
            SwarmSession(
                thread_id="legacy-unowned",
                user_id=None,
                requirement="Legacy project",
                status="done",
            ),
        ]
    )
    db.commit()

    service = SwarmGraphService(NoopGraph())
    app = FastAPI()
    app.include_router(swarm.router, prefix="/api/v1")
    app.dependency_overrides[get_swarm_graph_service] = lambda: service
    app.dependency_overrides[get_current_user] = lambda: user

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app), db


def test_list_sessions_returns_only_current_users_sessions_newest_first() -> None:
    client, _ = _client()

    response = client.get("/api/v1/swarm/sessions")

    assert response.status_code == 200
    payload = response.json()
    assert [item["thread_id"] for item in payload["sessions"]] == [
        "owner-new",
        "owner-old",
    ]
    assert payload["sessions"][0]["revision_number"] == 2
    assert "architecture_json" not in payload["sessions"][0]


def test_list_sessions_validates_and_applies_pagination() -> None:
    client, _ = _client()

    page = client.get("/api/v1/swarm/sessions", params={"limit": 1, "offset": 1})
    invalid = client.get("/api/v1/swarm/sessions", params={"limit": 101})

    assert page.status_code == 200
    assert [item["thread_id"] for item in page.json()["sessions"]] == ["owner-old"]
    assert invalid.status_code == 422


def test_session_detail_does_not_expose_another_users_session() -> None:
    client, _ = _client()

    owned = client.get("/api/v1/swarm/sessions/owner-new")
    foreign = client.get("/api/v1/swarm/sessions/other-session")
    legacy = client.get("/api/v1/swarm/sessions/legacy-unowned")

    assert owned.status_code == 200
    assert foreign.status_code == 404
    assert legacy.status_code == 404


def test_new_session_is_persisted_with_its_owner() -> None:
    _, db = _client()
    service = SwarmGraphService(NoopGraph())

    service._mark_session_running(db, "new-thread", "New requirement", 1)

    session = db.get(SwarmSession, "new-thread")
    assert session is not None
    assert session.user_id == 1


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        (
            "post",
            "/api/v1/swarm/run",
            {"thread_id": "other-session", "task_requirement": "Overwrite"},
        ),
        (
            "post",
            "/api/v1/swarm/run/stream",
            {"thread_id": "other-session", "task_requirement": "Overwrite"},
        ),
        ("post", "/api/v1/swarm/resume", {"thread_id": "other-session"}),
        ("post", "/api/v1/swarm/resume/stream", {"thread_id": "other-session"}),
        (
            "post",
            "/api/v1/swarm/revise",
            {"thread_id": "other-session", "instruction": "Change it"},
        ),
        (
            "post",
            "/api/v1/swarm/revise/stream",
            {"thread_id": "other-session", "instruction": "Change it"},
        ),
        ("get", "/api/v1/swarm/state/other-session", None),
        ("get", "/api/v1/swarm/sessions/other-session/revisions", None),
        ("get", "/api/v1/swarm/sessions/other-session/revisions/1", None),
    ],
)
def test_all_thread_specific_routes_hide_foreign_sessions(
    method: str,
    path: str,
    body: dict[str, str] | None,
) -> None:
    client, _ = _client()

    response = client.request(method, path, json=body)

    assert response.status_code == 404


def test_persisted_session_creation_requires_an_owner() -> None:
    _, db = _client()
    service = SwarmGraphService(NoopGraph())

    with pytest.raises(ValueError, match="user_id is required"):
        service._mark_session_running(db, "unowned-thread", "Requirement")

    assert db.get(SwarmSession, "unowned-thread") is None


def test_session_list_query_has_owner_and_created_at_index() -> None:
    index = next(
        item
        for item in SwarmSession.__table__.indexes
        if item.name == "ix_sessions_user_id_created_at"
    )

    assert [column.name for column in index.columns] == ["user_id", "created_at"]
