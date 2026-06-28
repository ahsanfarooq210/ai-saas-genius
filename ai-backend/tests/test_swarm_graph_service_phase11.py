"""Async Phase 11 swarm graph service behavior."""

import asyncio
from types import SimpleNamespace
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.swarm import SwarmDebateLog, SwarmSession, SwarmSessionArtifact
from app.services.swarm_graph_service import SwarmGraphService


class FakeAsyncGraph:
    def __init__(self, result: dict[str, Any] | None = None) -> None:
        self.ainvoke_calls: list[tuple[Any, dict[str, Any]]] = []
        self.aget_state_calls: list[dict[str, Any]] = []
        self.result = result

    async def ainvoke(self, state: Any, *, config: dict[str, Any]) -> dict[str, Any]:
        self.ainvoke_calls.append((state, config))
        if self.result is not None:
            return self.result
        if state is None:
            return {"thread_id": config["configurable"]["thread_id"], "resumed": True}
        return dict(state)

    async def aget_state(self, config: dict[str, Any]) -> SimpleNamespace:
        self.aget_state_calls.append(config)
        return SimpleNamespace(
            next=(),
            values={
                "component_list": ["API Gateway"],
                "complexity_score": 4,
                "diagram_plan": ["overview"],
                "generated_diagrams": [
                    {
                        "diagram_type": "overview",
                        "component_slug": "",
                        "storage_key": "swarm-artifacts/thread-3/diagrams/iter1_overview.mmd",
                        "url": "https://cdn.example/overview.mmd",
                        "iteration": 1,
                    }
                ],
                "generated_docs": [
                    {
                        "title": "System Overview",
                        "component_slug": "",
                        "storage_key": "swarm-artifacts/thread-3/docs/overview.md",
                        "url": "https://cdn.example/overview.md",
                    }
                ],
                "iteration_count": 2,
                "next_agent": "END",
            },
        )


class FailingAsyncGraph(FakeAsyncGraph):
    async def ainvoke(self, state: Any, *, config: dict[str, Any]) -> dict[str, Any]:
        self.ainvoke_calls.append((state, config))
        raise RuntimeError("graph failed")


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_run_uses_async_graph_with_initial_state_and_thread_config() -> None:
    graph = FakeAsyncGraph()
    service = SwarmGraphService(graph)

    result = asyncio.run(service.run("Design a URL shortener", "thread-1"))

    assert result["task_requirement"] == "Design a URL shortener"
    assert result["thread_id"] == "thread-1"
    state, config = graph.ainvoke_calls[0]
    assert state["task_requirement"] == "Design a URL shortener"
    assert state["generated_diagrams"] == []
    assert config == {"configurable": {"thread_id": "thread-1"}}


def test_resume_uses_async_graph_with_none_state() -> None:
    graph = FakeAsyncGraph()
    service = SwarmGraphService(graph)

    result = asyncio.run(service.resume("thread-2"))

    assert result == {"thread_id": "thread-2", "resumed": True}
    assert graph.ainvoke_calls == [
        (None, {"configurable": {"thread_id": "thread-2"}})
    ]


def test_get_checkpoint_uses_async_state_and_shapes_payload() -> None:
    graph = FakeAsyncGraph()
    service = SwarmGraphService(graph)

    payload = asyncio.run(service.get_checkpoint("thread-3"))

    assert graph.aget_state_calls == [{"configurable": {"thread_id": "thread-3"}}]
    assert payload["thread_id"] == "thread-3"
    assert payload["component_list"] == ["API Gateway"]
    assert payload["complexity_score"] == 4
    assert payload["iteration_count"] == 2
    assert payload["generated_diagrams"][0]["url"] == "https://cdn.example/overview.mmd"
    assert "values" not in payload


def test_run_creates_and_finalizes_swarm_session_with_debate_logs() -> None:
    db = _session()
    graph = FakeAsyncGraph(
        {
            "thread_id": "thread-4",
            "architecture_draft": "",
            "architecture_json": {
                "API Gateway": {
                    "description": "public edge",
                    "relations": ["URL Service"],
                }
            },
            "component_list": ["API Gateway", "URL Service"],
            "current_architecture_mermaid": "flowchart TD\nAPI-->URL",
            "complexity_score": 7,
            "diagram_plan": ["overview", "component-api-gateway"],
            "doc_plan": ["overview.md", "component-api-gateway.md"],
            "deep_dive_notes": "",
            "generated_diagrams": [
                {
                    "diagram_type": "overview",
                    "component_slug": "",
                    "storage_key": "swarm-artifacts/thread-4/diagrams/iter1_overview.mmd",
                    "url": "https://cdn.example/thread-4/overview.mmd",
                    "iteration": 1,
                }
            ],
            "generated_docs": [
                {
                    "title": "System Overview",
                    "component_slug": "",
                    "storage_key": "swarm-artifacts/thread-4/docs/overview.md",
                    "url": "https://cdn.example/thread-4/overview.md",
                }
            ],
            "docs_complete": True,
            "iteration_count": 3,
            "next_agent": "END",
            "scalability_feedback": "Looks scalable.\n\nSTATUS: APPROVED",
            "security_feedback": "Looks secure.\n\nSTATUS: APPROVED",
            "debate_logs": [
                {
                    "agent": "scalability",
                    "feedback": "Looks scalable.\n\nSTATUS: APPROVED",
                    "status": "APPROVED",
                    "iteration": 3,
                }
            ],
        }
    )
    service = SwarmGraphService(graph)

    asyncio.run(service.run("Design a URL shortener", "thread-4", db=db))

    session = db.get(SwarmSession, "thread-4")
    logs = db.query(SwarmDebateLog).filter_by(thread_id="thread-4").all()
    artifacts = db.query(SwarmSessionArtifact).filter_by(thread_id="thread-4").all()
    assert session is not None
    assert session.requirement == "Design a URL shortener"
    assert session.status == "done"
    assert session.complexity == 7
    assert session.diagram_count == 1
    assert session.doc_count == 1
    assert session.architecture_json == {
        "API Gateway": {
            "description": "public edge",
            "relations": ["URL Service"],
        }
    }
    assert session.component_list == ["API Gateway", "URL Service"]
    assert session.current_architecture_mermaid == "flowchart TD\nAPI-->URL"
    assert session.diagram_plan == ["overview", "component-api-gateway"]
    assert session.doc_plan == ["overview.md", "component-api-gateway.md"]
    assert session.docs_complete is True
    assert session.iteration_count == 3
    assert session.next_agent == "END"
    assert session.scalability_feedback == "Looks scalable.\n\nSTATUS: APPROVED"
    assert session.security_feedback == "Looks secure.\n\nSTATUS: APPROVED"
    assert len(logs) == 1
    assert logs[0].agent == "scalability"
    assert logs[0].status == "APPROVED"
    assert len(artifacts) == 2
    assert {artifact.artifact_type for artifact in artifacts} == {"diagram", "doc"}
    assert {artifact.url for artifact in artifacts} == {
        "https://cdn.example/thread-4/overview.mmd",
        "https://cdn.example/thread-4/overview.md",
    }


def test_run_marks_swarm_session_failed_when_graph_raises() -> None:
    db = _session()
    graph = FailingAsyncGraph()
    service = SwarmGraphService(graph)

    try:
        asyncio.run(service.run("Design a URL shortener", "thread-5", db=db))
    except RuntimeError as exc:
        assert str(exc) == "graph failed"
    else:
        raise AssertionError("expected graph failure")

    session = db.get(SwarmSession, "thread-5")
    assert session is not None
    assert session.requirement == "Design a URL shortener"
    assert session.status == "failed"


def test_resume_updates_existing_swarm_session_from_graph_result() -> None:
    db = _session()
    db.add(
        SwarmSession(
            thread_id="thread-6",
            requirement="Design a URL shortener",
            status="running",
        )
    )
    db.commit()
    graph = FakeAsyncGraph(
        {
            "thread_id": "thread-6",
            "complexity_score": 3,
            "generated_diagrams": [],
            "generated_docs": [
                {
                    "title": "System Overview",
                    "component_slug": "",
                    "storage_key": "swarm-artifacts/thread-6/docs/overview.md",
                    "url": "https://cdn.example/thread-6/overview.md",
                }
            ],
            "debate_logs": [],
        }
    )
    service = SwarmGraphService(graph)

    asyncio.run(service.resume("thread-6", db=db))

    session = db.get(SwarmSession, "thread-6")
    assert session is not None
    assert session.status == "done"
    assert session.complexity == 3
    assert session.diagram_count == 0
    assert session.doc_count == 1


def test_get_session_returns_sql_summary_and_artifact_urls() -> None:
    db = _session()
    db.add(
        SwarmSession(
            thread_id="thread-7",
            requirement="Design a URL shortener",
            status="done",
            complexity=5,
            diagram_count=1,
            doc_count=1,
            architecture_json={
                "API Gateway": {
                    "description": "public edge",
                    "relations": ["URL Service"],
                }
            },
            component_list=["API Gateway", "URL Service"],
            current_architecture_mermaid="flowchart TD\nAPI-->URL",
            diagram_plan=["overview", "component-api-gateway"],
            doc_plan=["overview.md", "component-api-gateway.md"],
            docs_complete=True,
            iteration_count=4,
            next_agent="END",
            scalability_feedback="Looks scalable.\n\nSTATUS: APPROVED",
            security_feedback="Looks secure.\n\nSTATUS: APPROVED",
        )
    )
    db.add_all(
        [
            SwarmSessionArtifact(
                thread_id="thread-7",
                artifact_type="diagram",
                storage_key="swarm-artifacts/thread-7/diagrams/iter1_overview.mmd",
                url="https://cdn.example/thread-7/overview.mmd",
                component_slug="",
                name="overview",
                iteration=1,
            ),
            SwarmSessionArtifact(
                thread_id="thread-7",
                artifact_type="doc",
                storage_key="swarm-artifacts/thread-7/docs/overview.md",
                url="https://cdn.example/thread-7/overview.md",
                component_slug="",
                name="System Overview",
                iteration=1,
            ),
        ]
    )
    db.add(
        SwarmDebateLog(
            thread_id="thread-7",
            agent="security",
            feedback="Looks secure.\n\nSTATUS: APPROVED",
            status="APPROVED",
            iteration=4,
        )
    )
    db.commit()
    service = SwarmGraphService(FakeAsyncGraph())

    payload = service.get_session("thread-7", db)

    assert payload["thread_id"] == "thread-7"
    assert payload["status"] == "done"
    assert payload["architecture_json"] == {
        "API Gateway": {
            "description": "public edge",
            "relations": ["URL Service"],
        }
    }
    assert payload["component_list"] == ["API Gateway", "URL Service"]
    assert payload["current_architecture_mermaid"] == "flowchart TD\nAPI-->URL"
    assert payload["diagram_plan"] == ["overview", "component-api-gateway"]
    assert payload["doc_plan"] == ["overview.md", "component-api-gateway.md"]
    assert payload["docs_complete"] is True
    assert payload["iteration_count"] == 4
    assert payload["next_agent"] == "END"
    assert payload["scalability_feedback"] == "Looks scalable.\n\nSTATUS: APPROVED"
    assert payload["security_feedback"] == "Looks secure.\n\nSTATUS: APPROVED"
    assert payload["debate_logs"] == [
        {
            "agent": "security",
            "feedback": "Looks secure.\n\nSTATUS: APPROVED",
            "status": "APPROVED",
            "iteration": 4,
        }
    ]
    assert payload["generated_diagrams"][0]["storage_key"] == (
        "swarm-artifacts/thread-7/diagrams/iter1_overview.mmd"
    )
    assert payload["generated_docs"][0]["url"] == "https://cdn.example/thread-7/overview.md"


def test_mark_session_done_replaces_existing_artifact_rows() -> None:
    db = _session()
    db.add(
        SwarmSession(
            thread_id="thread-8",
            requirement="Design a URL shortener",
            status="running",
        )
    )
    db.add(
        SwarmSessionArtifact(
            thread_id="thread-8",
            artifact_type="diagram",
            storage_key="old-key",
            url="https://cdn.example/old.mmd",
            component_slug="",
            name="overview",
            iteration=1,
        )
    )
    db.commit()
    service = SwarmGraphService(FakeAsyncGraph())

    service._mark_session_done(
        db,
        "thread-8",
        {
            "architecture_json": {
                "URL Service": {
                    "description": "creates short urls",
                    "relations": [],
                }
            },
            "component_list": ["URL Service"],
            "current_architecture_mermaid": "flowchart TD\nURL[URL Service]",
            "complexity_score": 2,
            "diagram_plan": ["overview"],
            "doc_plan": ["overview.md"],
            "generated_diagrams": [
                {
                    "diagram_type": "overview",
                    "component_slug": "",
                    "storage_key": "swarm-artifacts/thread-8/diagrams/iter2_overview.mmd",
                    "url": "https://cdn.example/thread-8/iter2_overview.mmd",
                    "iteration": 2,
                }
            ],
            "generated_docs": [],
            "docs_complete": False,
            "iteration_count": 2,
            "next_agent": "doc_generator_graph",
            "debate_logs": [],
        },
    )

    artifacts = db.query(SwarmSessionArtifact).filter_by(thread_id="thread-8").all()
    session = db.get(SwarmSession, "thread-8")
    assert len(artifacts) == 1
    assert artifacts[0].storage_key == "swarm-artifacts/thread-8/diagrams/iter2_overview.mmd"
    assert session is not None
    assert session.architecture_json == {
        "URL Service": {
            "description": "creates short urls",
            "relations": [],
        }
    }
    assert session.component_list == ["URL Service"]
    assert session.diagram_plan == ["overview"]
    assert session.doc_plan == ["overview.md"]
    assert session.iteration_count == 2
    assert session.next_agent == "doc_generator_graph"
