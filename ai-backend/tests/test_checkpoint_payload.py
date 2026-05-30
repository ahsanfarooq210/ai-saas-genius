"""Checkpoint shaping for GET /swarm/state."""

from types import SimpleNamespace

from app.agent.run import build_checkpoint_payload, diagram_checkpoint_items
from app.schemas.swarm import SwarmCheckpointResponse


def test_diagram_checkpoint_items_marks_syntax_errors() -> None:
    items = diagram_checkpoint_items(
        [
            {
                "diagram_type": "overview",
                "component_slug": "",
                "content": "flowchart TD\n  A[a]",
                "path": "diagrams/t/iter1_overview.mmd",
                "iteration": 1,
            },
            {
                "diagram_type": "auth-flow",
                "component_slug": "",
                "content": "syntax_error",
                "path": "",
                "iteration": 1,
            },
        ]
    )

    assert items[0]["valid"] is True
    assert items[1]["valid"] is False


def test_build_checkpoint_payload_matches_api_schema() -> None:
    snapshot = SimpleNamespace(
        next=(),
        values={
            "component_list": ["API Gateway"],
            "complexity_score": 4,
            "diagram_plan": ["overview", "auth-flow"],
            "iteration_count": 3,
            "next_agent": "scalability_node",
            "scalability_feedback": "STATUS: APPROVED",
            "security_feedback": "",
            "generated_diagrams": [
                {
                    "diagram_type": "overview",
                    "component_slug": "",
                    "content": "flowchart TD\n  A[a]",
                    "path": "p",
                    "iteration": 1,
                }
            ],
            "debate_logs": [
                {
                    "agent": "scalability",
                    "feedback": "All good.\n\nSTATUS: APPROVED",
                    "status": "APPROVED",
                    "iteration": 3,
                }
            ],
        },
    )

    payload = build_checkpoint_payload("thread-1", snapshot)
    response = SwarmCheckpointResponse.model_validate(payload)

    assert response.thread_id == "thread-1"
    assert response.generated_diagram_count == 1
    assert response.generated_diagrams[0].diagram_type == "overview"
    assert response.generated_diagrams[0].valid is True
    assert response.values["component_list"] == ["API Gateway"]
    assert response.iteration_count == 3
    assert response.next_agent == "scalability_node"
    assert response.scalability_feedback == "STATUS: APPROVED"
    assert response.security_feedback == ""
    assert response.debate_log_count == 1
    assert response.debate_logs[0].agent == "scalability"
    assert response.debate_logs[0].status == "APPROVED"
    assert response.debate_logs[0].iteration == 3
    assert "feedback" not in response.debate_logs[0].model_dump()
