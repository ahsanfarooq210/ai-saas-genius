"""Streaming behavior for SwarmGraphService without live LLM calls."""

import asyncio
import logging
from types import SimpleNamespace
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.swarm import SwarmSession, SwarmSessionArtifact
from app.services.swarm_graph_service import SwarmGraphService


class FakeStreamingGraph:
    def __init__(
        self,
        *,
        chunks: list[dict[str, Any]] | None = None,
        snapshot_values: dict[str, Any] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.chunks = chunks or []
        self.snapshot_values = snapshot_values or {}
        self.error = error
        self.astream_calls: list[dict[str, Any]] = []
        self.aget_state_calls: list[dict[str, Any]] = []

    async def astream(
        self,
        graph_input: Any,
        *,
        config: dict[str, Any],
        stream_mode: list[str],
        subgraphs: bool,
        version: str,
    ):
        self.astream_calls.append(
            {
                "input": graph_input,
                "config": config,
                "stream_mode": stream_mode,
                "subgraphs": subgraphs,
                "version": version,
            }
        )
        if self.error is not None:
            raise self.error
        for chunk in self.chunks:
            yield chunk

    async def aget_state(self, config: dict[str, Any]) -> SimpleNamespace:
        self.aget_state_calls.append(config)
        return SimpleNamespace(next=(), values=self.snapshot_values)


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


async def _collect(events) -> list[dict[str, Any]]:
    return [event async for event in events]


def test_stream_run_uses_initial_state_and_stream_options() -> None:
    graph = FakeStreamingGraph(
        chunks=[
            {
                "type": "updates",
                "ns": (),
                "data": {
                    "supervisor_node": {
                        "next_agent": "architect_graph",
                        "iteration_count": 1,
                    }
                },
            }
        ]
    )
    service = SwarmGraphService(graph)

    events = asyncio.run(
        _collect(service.stream_run("Design a URL shortener", "thread-1"))
    )

    call = graph.astream_calls[0]
    assert call["input"]["task_requirement"] == "Design a URL shortener"
    assert call["input"]["thread_id"] == "thread-1"
    assert call["input"]["generated_diagrams"] == []
    assert call["config"] == {"configurable": {"thread_id": "thread-1"}}
    assert call["stream_mode"] == ["tasks", "updates"]
    assert call["subgraphs"] is True
    assert call["version"] == "v2"
    assert events[0]["event"] == "progress"
    assert events[0]["data"]["node"] == "supervisor_node"
    assert events[-1] == {
        "event": "done",
        "data": {"thread_id": "thread-1", "status": "done"},
    }


def test_stream_resume_uses_none_input() -> None:
    graph = FakeStreamingGraph()
    service = SwarmGraphService(graph)

    events = asyncio.run(_collect(service.stream_resume("thread-2")))

    assert graph.astream_calls[0]["input"] is None
    assert graph.astream_calls[0]["config"] == {
        "configurable": {"thread_id": "thread-2"}
    }
    assert events == [
        {"event": "done", "data": {"thread_id": "thread-2", "status": "done"}}
    ]


def test_stream_run_finalizes_session_from_checkpoint_snapshot() -> None:
    db = _session()
    graph = FakeStreamingGraph(
        snapshot_values={
            "complexity_score": 5,
            "generated_diagrams": [
                {
                    "diagram_type": "overview",
                    "component_slug": "",
                    "storage_key": "swarm-artifacts/thread-3/diagrams/iter1_overview.mmd",
                    "url": "https://cdn.example/thread-3/overview.mmd",
                    "iteration": 1,
                }
            ],
            "generated_docs": [
                {
                    "title": "System Overview",
                    "component_slug": "",
                    "storage_key": "swarm-artifacts/thread-3/docs/overview.md",
                    "url": "https://cdn.example/thread-3/overview.md",
                }
            ],
            "debate_logs": [],
        }
    )
    service = SwarmGraphService(graph)

    events = asyncio.run(
        _collect(service.stream_run("Design a URL shortener", "thread-3", db=db))
    )

    assert graph.aget_state_calls == [{"configurable": {"thread_id": "thread-3"}}]
    assert events[-1] == {
        "event": "done",
        "data": {"thread_id": "thread-3", "status": "done"},
    }
    session = db.get(SwarmSession, "thread-3")
    artifacts = db.query(SwarmSessionArtifact).filter_by(thread_id="thread-3").all()
    assert session is not None
    assert session.requirement == "Design a URL shortener"
    assert session.status == "done"
    assert session.complexity == 5
    assert session.diagram_count == 1
    assert session.doc_count == 1
    assert {artifact.artifact_type for artifact in artifacts} == {"diagram", "doc"}


def test_stream_run_marks_failed_logs_and_emits_error_when_graph_raises(caplog) -> None:
    db = _session()
    graph = FakeStreamingGraph(error=RuntimeError("stream failed"))
    service = SwarmGraphService(graph)
    caplog.set_level(logging.ERROR, logger="app.services.swarm_graph_service")

    events = asyncio.run(
        _collect(service.stream_run("Design a URL shortener", "thread-4", db=db))
    )

    assert events == [
        {
            "event": "error",
            "data": {
                "thread_id": "thread-4",
                "status": "failed",
                "message": "stream failed",
            },
        }
    ]
    session = db.get(SwarmSession, "thread-4")
    assert session is not None
    assert session.status == "failed"
    assert "Swarm graph stream failed for thread_id=thread-4" in caplog.text
    assert "RuntimeError: stream failed" in caplog.text
