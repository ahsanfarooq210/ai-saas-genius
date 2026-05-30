"""Supervisor routing — deterministic only; no LLM."""

from app.agent.state.schema import GlobalSwarmState

MAX_ITERATIONS = 5


def supervisor_node(state: GlobalSwarmState) -> dict:
    """
    Reads state, decides what runs next, increments iteration_count.
    Never generates content — pure routing logic only.
    """
    iteration = state.get("iteration_count", 0) + 1

    # Allow the MAX_ITERATIONS-th supervisor pass to route normally.
    # Force END only after the run has already consumed that many passes.
    if iteration > MAX_ITERATIONS:
        next_agent = "END"
    else:
        next_agent = _route(state)

    print(f"\n[supervisor] iteration={iteration} → routing to: {next_agent}")

    return {
        "iteration_count": iteration,
        "next_agent": next_agent,
    }


def _route(state: GlobalSwarmState) -> str:
    """
    Priority-ordered routing rules — checked top to bottom.
    Circuit breaker is handled in supervisor_node (post-increment).
    """
    if not state.get("component_list"):
        return "architect_graph"

    if not state.get("docs_complete"):
        return "doc_generator_graph"

    scalability = state.get("scalability_feedback", "")
    if "REJECTED" in scalability:
        return "architect_graph"
    if not scalability:
        return "scalability_node"

    security = state.get("security_feedback", "")
    if "REJECTED" in security:
        return "architect_graph"
    if not security:
        return "security_node"

    return "END"


def supervisor_route(state: GlobalSwarmState) -> str:
    """
    Routing function passed to add_conditional_edges.
    Reads next_agent from state — set by supervisor_node just before this runs.
    """
    return state["next_agent"]
