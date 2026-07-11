from fastapi import FastAPI
from fastapi.testclient import TestClient
from langgraph.types import Overwrite

from app.agent.streaming import normalize_stream_chunk
from app.api.deps import get_swarm_graph_service
from app.api.v1.endpoints import swarm
from app.db.session import get_db
from app.schemas.swarm import SwarmStreamProgressEvent
from app.services.swarm_graph_service import (
    SwarmSessionBusyError,
    UnknownSwarmSessionError,
)


class FakeStreamingService:
    def __init__(self) -> None:
        self.run_calls: list[tuple[str, str, object]] = []
        self.resume_calls: list[tuple[str, object]] = []
        self.revise_calls: list[tuple[str, str, object]] = []

    async def stream_run(self, task_requirement: str, thread_id: str, *, db=None):
        self.run_calls.append((task_requirement, thread_id, db))
        yield {
            "event": "progress",
            "data": {
                "thread_id": thread_id,
                "type": "task_started",
                "node": "supervisor_node",
                "phase": "supervisor",
                "message": "Choosing the next graph step",
                "iteration_count": 1,
                "payload": {"next_agent": "architect_graph", "iteration_count": 1},
            },
        }
        yield {"event": "done", "data": {"thread_id": thread_id, "status": "done"}}

    async def stream_resume(self, thread_id: str, *, db=None):
        self.resume_calls.append((thread_id, db))
        yield {
            "event": "progress",
            "data": {
                "thread_id": thread_id,
                "type": "task_started",
                "node": "doc_generator_graph",
                "phase": "documentation",
                "message": "Running documentation generation",
                "iteration_count": None,
                "payload": {},
            },
        }
        yield {"event": "done", "data": {"thread_id": thread_id, "status": "done"}}

    async def stream_revise(self, instruction: str, thread_id: str, *, db=None):
        self.revise_calls.append((instruction, thread_id, db))

        async def events():
            yield {
                "event": "progress",
                "data": {
                    "thread_id": thread_id,
                    "type": "task_started",
                    "node": "architect_graph",
                    "phase": "architecture",
                    "message": "Running architecture generation",
                    "iteration_count": 1,
                    "payload": {},
                },
            }
            yield {
                "event": "done",
                "data": {"thread_id": thread_id, "status": "done"},
            }

        return events()


def _app_with_service(service: FakeStreamingService) -> FastAPI:
    app = FastAPI()
    app.include_router(swarm.router, prefix="/api/v1")

    def override_db():
        yield object()

    app.dependency_overrides[get_swarm_graph_service] = lambda: service
    app.dependency_overrides[get_db] = override_db
    return app


def test_normalizes_top_level_task_start() -> None:
    events = normalize_stream_chunk(
        "thread-1",
        {
            "type": "tasks",
            "ns": (),
            "data": {
                "id": "task-1",
                "name": "draft_architecture_node",
                "input": {
                    "task_requirement": "Design a payments system",
                    "architecture_json": {"API": {}},
                    "current_architecture_mermaid": "flowchart TD",
                },
                "triggers": ("branch:to:draft_architecture_node",),
            },
        },
    )

    assert len(events) == 1
    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.thread_id == "thread-1"
    assert event.type == "task_started"
    assert event.node == "draft_architecture_node"
    assert event.phase == "architecture"
    assert event.payload == {"component_count": 1}
    assert "task_requirement" not in event.payload
    assert "architecture_json" not in event.payload
    assert "current_architecture_mermaid" not in event.payload


def test_normalizes_nested_subgraph_task_start_with_safe_worker_metadata() -> None:
    events = normalize_stream_chunk(
        "thread-2",
        {
            "type": "tasks",
            "ns": ("architect_graph:abc",),
            "data": {
                "id": "task-2",
                "name": "diagram_generator_node",
                "input": {
                    "diagram_type": "overview",
                    "component_slug": "",
                    "task_requirement": "Design a URL shortener",
                    "architecture_json": {"API Gateway": {}},
                    "iteration": 2,
                },
                "triggers": ("branch:to:diagram_generator_node",),
            },
        },
    )

    assert len(events) == 1
    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.type == "task_started"
    assert event.node == "diagram_generator_node"
    assert event.phase == "diagram"
    assert event.iteration_count == 2
    assert event.payload == {
        "diagram_type": "overview",
        "component_slug": "",
        "iteration": 2,
    }


def test_normalizes_state_update_without_large_architecture_fields() -> None:
    events = normalize_stream_chunk(
        "thread-3",
        {
            "type": "updates",
            "ns": ("architect_graph:def",),
            "data": {
                "draft_architecture_node": {
                    "component_list": ["API Gateway", "Database"],
                    "architecture_json": {"API Gateway": {}, "Database": {}},
                    "current_architecture_mermaid": "flowchart TD",
                }
            },
        },
    )

    assert len(events) == 1
    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.type == "state_update"
    assert event.payload == {"component_count": 2}
    assert "architecture_json" not in event.payload
    assert "current_architecture_mermaid" not in event.payload


def test_normalizes_diagram_update_without_artifact_urls() -> None:
    events = normalize_stream_chunk(
        "thread-4",
        {
            "type": "updates",
            "ns": ("architect_graph:ghi",),
            "data": {
                "diagram_generator_node": {
                    "generated_diagrams": [
                        {
                            "diagram_type": "overview",
                            "component_slug": "",
                            "storage_key": "swarm-artifacts/thread-4/overview.mmd",
                            "url": "https://cdn.example/overview.mmd",
                            "iteration": 1,
                        }
                    ]
                }
            },
        },
    )

    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.payload == {
        "diagram_type": "overview",
        "component_slug": "",
        "iteration": 1,
        "valid": True,
    }
    assert "storage_key" not in event.payload
    assert "url" not in event.payload


def test_normalizes_reviewer_update_to_status_only() -> None:
    events = normalize_stream_chunk(
        "thread-5",
        {
            "type": "updates",
            "ns": (),
            "data": {
                "security_node": {
                    "security_feedback": (
                        "Detailed security critique that must not be streamed.\n\n"
                        "STATUS: REJECTED"
                    ),
                    "debate_logs": [
                        {
                            "agent": "security",
                            "feedback": "full private feedback",
                            "status": "REJECTED",
                            "iteration": 3,
                        }
                    ],
                }
            },
        },
    )

    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.phase == "review"
    assert event.payload == {"status": "REJECTED"}


def test_normalizes_reduce_diagrams_update_with_overwrite_value() -> None:
    events = normalize_stream_chunk(
        "thread-6",
        {
            "type": "updates",
            "ns": ("architect_graph:mno",),
            "data": {
                "reduce_diagrams_node": {
                    "generated_diagrams": Overwrite(
                        [
                            {
                                "diagram_type": "overview",
                                "component_slug": "",
                                "storage_key": "swarm-artifacts/thread-6/overview.mmd",
                                "url": "https://cdn.example/overview.mmd",
                                "iteration": 1,
                            },
                            {
                                "diagram_type": "auth-flow",
                                "component_slug": "",
                                "storage_key": "swarm-artifacts/thread-6/auth-flow.mmd",
                                "url": "https://cdn.example/auth-flow.mmd",
                                "iteration": 1,
                            },
                        ]
                    )
                }
            },
        },
    )

    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.node == "reduce_diagrams_node"
    assert event.payload == {"generated_diagram_count": 2}


def test_normalizes_reduce_docs_update_with_overwrite_value() -> None:
    events = normalize_stream_chunk(
        "thread-7",
        {
            "type": "updates",
            "ns": ("doc_generator_graph:pqr",),
            "data": {
                "reduce_docs_node": {
                    "generated_docs": Overwrite(
                        [
                            {"title": "System Overview", "component_slug": ""},
                            {
                                "title": "Api Gateway Component Overview",
                                "component_slug": "component-api-gateway",
                            },
                        ]
                    ),
                    "docs_complete": True,
                }
            },
        },
    )

    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.node == "reduce_docs_node"
    assert event.payload == {"generated_doc_count": 2, "docs_complete": True}


def test_normalizes_task_completion_payload() -> None:
    events = normalize_stream_chunk(
        "thread-8",
        {
            "type": "tasks",
            "ns": ("architect_graph:jkl",),
            "data": {
                "id": "task-6",
                "name": "score_complexity_node",
                "error": None,
                "result": {
                    "complexity_score": 6,
                    "diagram_plan": ["overview", "auth-flow"],
                    "doc_plan": ["overview.md"],
                },
                "interrupts": [],
            },
        },
    )

    event = SwarmStreamProgressEvent.model_validate(events[0])
    assert event.type == "task_completed"
    assert event.payload == {
        "complexity_score": 6,
        "diagram_count": 2,
        "doc_count": 1,
    }


def test_run_stream_route_returns_sse_progress_and_done_events() -> None:
    service = FakeStreamingService()
    client = TestClient(_app_with_service(service))

    with client.stream(
        "POST",
        "/api/v1/swarm/run/stream",
        json={
            "task_requirement": "Design a URL shortener",
            "thread_id": "thread-9",
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: progress" in body
    assert (
        'data: {"thread_id":"thread-9","type":"task_started",'
        '"node":"supervisor_node"'
    ) in body
    assert "event: done" in body
    assert 'data: {"thread_id":"thread-9","status":"done"}' in body
    assert service.run_calls[0][0] == "Design a URL shortener"
    assert service.run_calls[0][1] == "thread-9"
    assert service.run_calls[0][2] is not None


def test_resume_stream_route_returns_sse_progress_and_done_events() -> None:
    service = FakeStreamingService()
    client = TestClient(_app_with_service(service))

    with client.stream(
        "POST",
        "/api/v1/swarm/resume/stream",
        json={"thread_id": "thread-10"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: progress" in body
    assert '"node":"doc_generator_graph"' in body
    assert "event: done" in body
    assert 'data: {"thread_id":"thread-10","status":"done"}' in body
    assert service.resume_calls[0][0] == "thread-10"
    assert service.resume_calls[0][1] is not None


def test_revise_stream_route_returns_sse_and_forwards_instruction() -> None:
    service = FakeStreamingService()
    client = TestClient(_app_with_service(service))

    with client.stream(
        "POST",
        "/api/v1/swarm/revise/stream",
        json={"thread_id": "thread-11", "instruction": "Use Redis"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"node":"architect_graph"' in body
    assert 'data: {"thread_id":"thread-11","status":"done"}' in body
    assert service.revise_calls[0][0:2] == ("Use Redis", "thread-11")
    assert service.revise_calls[0][2] is not None


def test_revise_routes_validate_instruction_and_map_session_errors() -> None:
    class ErrorService(FakeStreamingService):
        async def revise(self, instruction: str, thread_id: str, *, db=None):
            if thread_id == "missing":
                raise UnknownSwarmSessionError(thread_id)
            raise SwarmSessionBusyError(thread_id)

    client = TestClient(_app_with_service(ErrorService()))

    blank = client.post(
        "/api/v1/swarm/revise",
        json={"thread_id": "thread-1", "instruction": ""},
    )
    missing = client.post(
        "/api/v1/swarm/revise",
        json={"thread_id": "missing", "instruction": "Use Redis"},
    )
    busy = client.post(
        "/api/v1/swarm/revise",
        json={"thread_id": "thread-1", "instruction": "Use Redis"},
    )

    assert blank.status_code == 422
    assert missing.status_code == 404
    assert busy.status_code == 409
