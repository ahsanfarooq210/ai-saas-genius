"""Phase 9 supervisor routing — unit tests only (no LLM)."""

from typing import Any, cast

from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.supervisor_router import MAX_ITERATIONS, _route, supervisor_node


def _base_state(**overrides: Any) -> GlobalSwarmState:
    state: dict[str, Any] = {
        "task_requirement": "Design a URL shortener",
        "architecture_draft": "",
        "architecture_json": {},
        "component_list": [],
        "current_architecture_mermaid": "",
        "complexity_score": 0,
        "diagram_plan": [],
        "doc_plan": [],
        "deep_dive_notes": "",
        "generated_diagrams": [],
        "thread_id": "test-thread",
        "generated_docs": [],
        "docs_complete": False,
        "iteration_count": 0,
        "next_agent": "",
        "scalability_feedback": "",
        "security_feedback": "",
        "debate_logs": [],
    }
    state.update(overrides)
    return cast(GlobalSwarmState, state)


def test_route_empty_component_list_to_architect() -> None:
    assert _route(_base_state()) == "architect_graph"


def test_route_architecture_ready_docs_incomplete_to_doc_graph() -> None:
    state = _base_state(
        component_list=["API Gateway"],
        architecture_json={"API Gateway": {"description": "x", "relations": []}},
        docs_complete=False,
    )
    assert _route(state) == "doc_generator_graph"


def test_route_docs_complete_empty_scalability_to_scalability_node() -> None:
    state = _base_state(
        component_list=["API Gateway"],
        docs_complete=True,
        scalability_feedback="",
    )
    assert _route(state) == "scalability_node"


def test_route_scalability_approved_empty_security_to_security_node() -> None:
    state = _base_state(
        component_list=["API Gateway"],
        docs_complete=True,
        scalability_feedback="STATUS: APPROVED",
        security_feedback="",
    )
    assert _route(state) == "security_node"


def test_route_both_approved_to_end() -> None:
    state = _base_state(
        component_list=["API Gateway"],
        docs_complete=True,
        scalability_feedback="STATUS: APPROVED",
        security_feedback="STATUS: APPROVED",
    )
    assert _route(state) == "END"


def test_route_scalability_rejected_to_architect() -> None:
    state = _base_state(
        component_list=["API Gateway"],
        docs_complete=True,
        scalability_feedback="No caching layer. STATUS: REJECTED",
    )
    assert _route(state) == "architect_graph"


def test_route_security_rejected_to_architect() -> None:
    state = _base_state(
        component_list=["API Gateway"],
        docs_complete=True,
        scalability_feedback="STATUS: APPROVED",
        security_feedback="Exposed DB. STATUS: REJECTED",
    )
    assert _route(state) == "architect_graph"


def test_supervisor_node_allows_maxth_pass_to_route() -> None:
    state = _base_state(iteration_count=MAX_ITERATIONS - 1)
    update = supervisor_node(state)

    assert update["iteration_count"] == MAX_ITERATIONS
    assert update["next_agent"] == "architect_graph"


def test_supervisor_node_circuit_breaker_after_cap() -> None:
    state = _base_state(iteration_count=MAX_ITERATIONS)
    update = supervisor_node(state)

    assert update["iteration_count"] == MAX_ITERATIONS + 1
    assert update["next_agent"] == "END"


def test_supervisor_node_routes_doc_regeneration_on_maxth_pass() -> None:
    state = _base_state(
        iteration_count=MAX_ITERATIONS - 1,
        component_list=["Token Vault"],
        architecture_json={"Token Vault": {"description": "x", "relations": []}},
        docs_complete=False,
    )
    update = supervisor_node(state)

    assert update["iteration_count"] == MAX_ITERATIONS
    assert update["next_agent"] == "doc_generator_graph"


def test_supervisor_node_increments_and_routes() -> None:
    state = _base_state()
    update = supervisor_node(state)

    assert update["iteration_count"] == 1
    assert update["next_agent"] == "architect_graph"
