"""Async Phase 11 swarm graph service behavior."""

import asyncio
from types import SimpleNamespace
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.swarm import SwarmDebateLog, SwarmSession
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


def test_run_creates_and_finalizes_swarm_session_with_debate_logs() -> None:
    db = _session()
    graph = FakeAsyncGraph(
        {
            "thread_id": "thread-4",
            "complexity_score": 7,
            "generated_diagrams": [{"path": "diagrams/thread-4/overview.mmd"}],
            "generated_docs": [{"path": "reports/thread-4/overview.md"}],
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
    assert session is not None
    assert session.requirement == "Design a URL shortener"
    assert session.status == "done"
    assert session.complexity == 7
    assert session.diagram_count == 1
    assert session.doc_count == 1
    assert len(logs) == 1
    assert logs[0].agent == "scalability"
    assert logs[0].status == "APPROVED"


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
            "generated_docs": [{"path": "reports/thread-6/overview.md"}],
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
