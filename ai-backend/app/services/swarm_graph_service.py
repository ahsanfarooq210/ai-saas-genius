from typing import Any

from app.agent.run import GraphBuilder
from app.agent.state.schema import GlobalSwarmState


class SwarmGraphService:
    """Compiles the swarm graph once and runs `invoke` for HTTP callers."""

    def __init__(self) -> None:
        self._graph = GraphBuilder().build_graph()

    def run(self, task_requirement: str) -> dict[str, Any]:
        initial: GlobalSwarmState = {
            "task_requirement": task_requirement,
            "architecture_draft": "",
        }
        return self._graph.invoke(initial)
