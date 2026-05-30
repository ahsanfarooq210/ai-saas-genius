"""Phase 10 reviewer nodes — mocked LLM, no network."""

from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage

from app.agent.subagents.scalability_expert import scalability_node
from app.agent.subagents.security_auditor import security_node


def _base_state(**overrides) -> dict:
    state = {
        "task_requirement": "Design a URL shortener",
        "architecture_json": {"API": {"description": "gateway", "relations": []}},
        "generated_diagrams": [
            {
                "diagram_type": "overview",
                "component_slug": "",
                "content": "flowchart TD\n  A[a]",
                "path": "p",
                "iteration": 1,
            }
        ],
        "generated_docs": [
            {
                "title": "overview.md",
                "component_slug": "",
                "content": "# Overview",
                "path": "r/overview.md",
            }
        ],
        "iteration_count": 3,
    }
    state.update(overrides)
    return state


@patch("app.agent.subagents.scalability_expert._llm")
def test_scalability_node_returns_feedback_and_debate_log(mock_llm: MagicMock) -> None:
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


@patch("app.agent.subagents.security_auditor._llm")
def test_security_node_returns_feedback_and_debate_log(mock_llm: MagicMock) -> None:
    mock_llm.invoke.return_value = AIMessage(
        content="TLS everywhere.\n\nSTATUS: APPROVED"
    )

    result = security_node(_base_state(iteration_count=4))

    assert "security_feedback" in result
    assert "APPROVED" in result["security_feedback"]
    assert result["debate_logs"][0]["agent"] == "security"
    assert result["debate_logs"][0]["status"] == "APPROVED"
    assert result["debate_logs"][0]["iteration"] == 4
