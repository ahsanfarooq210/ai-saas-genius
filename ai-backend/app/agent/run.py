"""Compile the swarm graph (used by SwarmGraphService and the API)."""

from app.agent.graphs.supervisor_graph import supervisor_graph


def swarm_config(thread_id: str) -> dict:
    """LangGraph checkpointer config — same thread_id resumes the same checkpoint."""
    return {"configurable": {"thread_id": thread_id}}


class GraphBuilder:
    """Returns the compiled parent graph; does not wire sub-graph nodes directly."""

    def __init__(self) -> None:
        self.graph = None

    def build_graph(self):
        self.graph = supervisor_graph
        return self.graph
