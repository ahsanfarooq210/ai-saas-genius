"""Phase 10 reviewer nodes — mocked LLM, no network."""

from typing import Any, cast
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage

from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.scalability_expert import scalability_node
from app.agent.subagents.security_auditor import security_node


def _base_state(**overrides: Any) -> GlobalSwarmState:
    state: dict[str, Any] = {
        "task_requirement": "Design a URL shortener",
        "architecture_draft": "",
        "architecture_json": {"API": {"description": "gateway", "relations": []}},
        "component_list": ["API"],
        "current_architecture_mermaid": "",
        "complexity_score": 0,
        "diagram_plan": [],
        "doc_plan": [],
        "deep_dive_notes": "",
        "generated_diagrams": [
            {
                "diagram_type": "overview",
                "component_slug": "",
                "storage_key": "swarm-artifacts/test-thread/diagrams/iter1_overview.mmd",
                "url": "https://cdn.example/test-thread/overview.mmd",
                "iteration": 1,
            }
        ],
        "thread_id": "test-thread",
        "generated_docs": [
            {
                "title": "System Overview",
                "component_slug": "",
                "storage_key": "swarm-artifacts/test-thread/docs/overview.md",
                "url": "https://cdn.example/test-thread/overview.md",
            }
        ],
        "docs_complete": True,
        "iteration_count": 3,
        "next_agent": "",
        "scalability_feedback": "",
        "security_feedback": "",
        "debate_logs": [],
    }
    state.update(overrides)
    return cast(GlobalSwarmState, state)


@patch("app.agent.subagents.reviewer_common.artifact_store.read_text")
@patch("app.agent.subagents.scalability_expert._llm")
def test_scalability_node_returns_feedback_and_debate_log(
    mock_llm: MagicMock,
    mock_read_text: MagicMock,
) -> None:
    mock_read_text.side_effect = ["flowchart TD\n  A[a]", "# Overview"]
    mock_llm.invoke.return_value = AIMessage(
        content="Missing cache layer.\n\nSTATUS: REJECTED"
    )

    result = scalability_node(_base_state())

    assert "scalability_feedback" in result
    assert "REJECTED" in result["scalability_feedback"]
    assert len(result["debate_logs"]) == 1
    assert result["debate_logs"][0]["agent"] == "scalability"
    assert result["debate_logs"][0]["status"] == "REJECTED"
    assert result["debate_logs"][0]["iteration"] == 3
    user_prompt = mock_llm.invoke.call_args.args[0][1]["content"]
    assert "flowchart TD\n  A[a]" in user_prompt
    assert "# Overview" in user_prompt


@patch("app.agent.subagents.reviewer_common.artifact_store.read_text")
@patch("app.agent.subagents.security_auditor._llm")
def test_security_node_returns_feedback_and_debate_log(
    mock_llm: MagicMock,
    mock_read_text: MagicMock,
) -> None:
    mock_read_text.side_effect = ["flowchart TD\n  A[a]", "# Overview"]
    mock_llm.invoke.return_value = AIMessage(
        content="TLS everywhere.\n\nSTATUS: APPROVED"
    )

    result = security_node(_base_state(iteration_count=4))

    assert "security_feedback" in result
    assert "APPROVED" in result["security_feedback"]
    assert result["debate_logs"][0]["agent"] == "security"
    assert result["debate_logs"][0]["status"] == "APPROVED"
    assert result["debate_logs"][0]["iteration"] == 4


@patch("app.agent.subagents.reviewer_common.artifact_store.read_text")
@patch("app.agent.subagents.scalability_expert._llm")
def test_scalability_node_appends_to_existing_debate_logs(
    mock_llm: MagicMock,
    mock_read_text: MagicMock,
) -> None:
    mock_read_text.side_effect = ["flowchart TD\n  A[a]", "# Overview"]
    mock_llm.invoke.return_value = AIMessage(
        content="Still missing cache layer.\n\nSTATUS: REJECTED"
    )

    result = scalability_node(
        _base_state(
            debate_logs=[
                {
                    "agent": "security",
                    "feedback": "Looks good.\n\nSTATUS: APPROVED",
                    "status": "APPROVED",
                    "iteration": 2,
                }
            ]
        )
    )

    assert len(result["debate_logs"]) == 2
    assert result["debate_logs"][0]["agent"] == "security"
    assert result["debate_logs"][1]["agent"] == "scalability"
