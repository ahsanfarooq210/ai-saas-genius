"""Iterative architecture revision behavior without live LLM calls."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent.subagents._schema import ArchitectureOutput
from app.agent.subagents.lead_architect import LeadArchitect
from app.api.deps import get_current_user, get_swarm_graph_service
from app.api.v1.endpoints import swarm
from app.db.base import Base
from app.db.session import get_db
from app.models.swarm import SwarmRevision, SwarmSession, SwarmSessionArtifact
from app.services.swarm_graph_service import (
    SwarmGraphService,
    SwarmSessionBusyError,
    UnknownSwarmSessionError,
)


class RevisionGraph:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, Any], dict[str, Any]]] = []
        self.fail_next = False

    async def ainvoke(
        self,
        state: dict[str, Any],
        *,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        self.calls.append((state, config))
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("revision failed")

        revision = int(state.get("revision_number") or 1)
        revised = bool(state.get("revision_instruction"))
        architecture = {
            "API Gateway": {"description": "public edge", "relations": ["Database"]},
            "Database": {"description": "stores URLs", "relations": []},
        }
        if revised:
            architecture["Redis"] = {
                "description": "distributed cache with failover",
                "relations": ["Database"],
            }
        return {
            **state,
            "architecture_json": architecture,
            "component_list": list(architecture),
            "current_architecture_mermaid": "flowchart TD\nAPI-->DB",
            "complexity_score": 5,
            "diagram_plan": ["overview"],
            "doc_plan": ["overview.md"],
            "generated_diagrams": [
                {
                    "diagram_type": "overview",
                    "component_slug": "",
                    "storage_key": (
                        f"swarm-artifacts/thread-1/revisions/{revision}/"
                        "diagrams/iter1_overview.mmd"
                    ),
                    "url": f"https://cdn.example/revisions/{revision}/overview.mmd",
                    "iteration": 1,
                }
            ],
            "generated_docs": [
                {
                    "title": "System Overview",
                    "component_slug": "",
                    "storage_key": (
                        f"swarm-artifacts/thread-1/revisions/{revision}/docs/overview.md"
                    ),
                    "url": f"https://cdn.example/revisions/{revision}/overview.md",
                }
            ],
            "docs_complete": True,
            "iteration_count": 5,
            "next_agent": "END",
            "revision_pending": False,
            "scalability_feedback": "STATUS: APPROVED",
            "security_feedback": "STATUS: APPROVED",
            "debate_logs": [],
        }


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_revision_builds_on_latest_result_and_promotes_new_version() -> None:
    db = _session()
    graph = RevisionGraph()
    service = SwarmGraphService(graph)

    asyncio.run(
        service.run("Design a URL shortener", "thread-1", db=db, user_id=1)
    )
    result = asyncio.run(
        service.revise(
            "Replace the cache with Redis and explain failover",
            "thread-1",
            db=db,
            user_id=1,
        )
    )

    revision_input = graph.calls[1][0]
    assert revision_input["architecture_json"]["Database"]["description"] == "stores URLs"
    assert revision_input["revision_number"] == 2
    assert revision_input["revision_pending"] is True
    assert revision_input["iteration_count"] == 0
    assert revision_input["docs_complete"] is False
    assert revision_input["scalability_feedback"] == ""
    assert revision_input["security_feedback"] == ""
    assert revision_input["debate_logs"] == []
    assert "Redis" in result["architecture_json"]

    session = db.get(SwarmSession, "thread-1")
    assert session is not None
    assert session.requirement == "Design a URL shortener"
    assert session.current_revision == 2
    assert session.status == "done"
    assert "Redis" in (session.architecture_json or {})
    assert db.query(SwarmRevision).filter_by(thread_id="thread-1").count() == 2
    assert {
        item.storage_key
        for item in db.query(SwarmSessionArtifact).filter_by(thread_id="thread-1")
    } == {
        "swarm-artifacts/thread-1/revisions/2/diagrams/iter1_overview.mmd",
        "swarm-artifacts/thread-1/revisions/2/docs/overview.md",
    }

    history = service.list_revisions("thread-1", db, user_id=1)
    assert history["current_revision"] == 2
    assert [item["status"] for item in history["revisions"]] == ["done", "done"]
    first = service.get_revision("thread-1", 1, db, user_id=1)
    second = service.get_revision("thread-1", 2, db, user_id=1)
    assert "Redis" not in first["result"]["architecture_json"]
    assert "Redis" in second["result"]["architecture_json"]


def test_failed_revision_does_not_replace_last_successful_result() -> None:
    db = _session()
    graph = RevisionGraph()
    service = SwarmGraphService(graph)
    asyncio.run(
        service.run("Design a URL shortener", "thread-1", db=db, user_id=1)
    )
    graph.fail_next = True

    with pytest.raises(RuntimeError, match="revision failed"):
        asyncio.run(service.revise("Use Redis", "thread-1", db=db, user_id=1))

    session = db.get(SwarmSession, "thread-1")
    assert session is not None
    assert session.current_revision == 1
    assert session.status == "failed"
    assert "Redis" not in (session.architecture_json or {})
    failed = service.get_revision("thread-1", 2, db, user_id=1)
    assert failed["status"] == "failed"
    assert failed["result"] == {}
    artifacts = db.query(SwarmSessionArtifact).filter_by(thread_id="thread-1").all()
    assert all("/revisions/1/" in item.storage_key for item in artifacts)


def test_revision_rejects_unknown_and_running_threads() -> None:
    db = _session()
    service = SwarmGraphService(RevisionGraph())

    with pytest.raises(UnknownSwarmSessionError):
        asyncio.run(service.revise("Use Redis", "missing", db=db, user_id=1))

    db.add(
        SwarmSession(
            thread_id="thread-1",
            user_id=1,
            requirement="Design a URL shortener",
            status="running",
            current_revision=1,
        )
    )
    db.commit()
    with pytest.raises(SwarmSessionBusyError):
        asyncio.run(service.revise("Use Redis", "thread-1", db=db, user_id=1))


def test_revision_history_endpoints_return_versioned_results() -> None:
    db = _session()
    graph = RevisionGraph()
    service = SwarmGraphService(graph)
    asyncio.run(
        service.run("Design a URL shortener", "thread-1", db=db, user_id=1)
    )
    asyncio.run(service.revise("Use Redis", "thread-1", db=db, user_id=1))

    app = FastAPI()
    app.include_router(swarm.router, prefix="/api/v1")
    app.dependency_overrides[get_swarm_graph_service] = lambda: service
    app.dependency_overrides[get_current_user] = lambda: type(
        "CurrentUser", (), {"id": 1}
    )()

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)

    history = client.get("/api/v1/swarm/sessions/thread-1/revisions")
    first = client.get("/api/v1/swarm/sessions/thread-1/revisions/1")
    missing = client.get("/api/v1/swarm/sessions/thread-1/revisions/99")

    assert history.status_code == 200
    assert history.json()["current_revision"] == 2
    assert [item["revision_number"] for item in history.json()["revisions"]] == [1, 2]
    assert first.status_code == 200
    assert "Redis" not in first.json()["result"]["architecture_json"]
    assert missing.status_code == 404


@patch("app.agent.subagents.lead_architect._structured_llm")
def test_lead_architect_prompt_contains_current_architecture_and_instruction(
    mock_llm: MagicMock,
) -> None:
    mock_llm.invoke.return_value = ArchitectureOutput.model_validate(
        {
            "architecture_json": {
                "API": {"description": "edge", "relations": ["Redis"]},
                "Redis": {"description": "cache", "relations": []},
            },
            "component_list": ["API", "Redis"],
            "current_architecture_mermaid": "flowchart TD\nAPI-->Redis",
        }
    )
    state: dict[str, Any] = {
        "task_requirement": "Design a URL shortener",
        "revision_number": 2,
        "revision_instruction": "Replace the local cache with Redis",
        "revision_pending": True,
        "architecture_json": {
            "API": {"description": "edge", "relations": ["Local Cache"]},
            "Local Cache": {"description": "cache", "relations": []},
        },
        "current_architecture_mermaid": "flowchart TD\nAPI-->Cache",
        "scalability_feedback": "",
        "security_feedback": "",
    }

    update = LeadArchitect().draft_architecture_node(state)  # type: ignore[arg-type]

    prompt = mock_llm.invoke.call_args.args[0][1]["content"]
    assert "Original system requirement:\nDesign a URL shortener" in prompt
    assert "Local Cache" in prompt
    assert "New revision instruction:\nReplace the local cache with Redis" in prompt
    assert update["revision_pending"] is False
    assert update["component_list"] == ["API", "Redis"]
