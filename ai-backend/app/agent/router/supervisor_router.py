from app.agent.state.schema import GlobalSwarmState


def route_after_complexity(state: GlobalSwarmState) -> str:
    """
    Routing function — reads state only, returns a node name string.
    Python owns control flow. Never put routing logic in a prompt.

    This is a rehearsal for supervisor_route() in Phase 9,
    which follows the exact same pattern with more branches.
    """

    if state["complexity_score"] >= 7:
        return "deep_dive"  # maps to "deep_dive_node" in the graph
    return "summarize"  # maps to "summarize_node" in the graph
