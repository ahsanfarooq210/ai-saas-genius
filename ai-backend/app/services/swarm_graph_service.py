from typing import Any

from app.agent.run import GraphBuilder, build_checkpoint_payload, swarm_config
from app.agent.state.schema import GlobalSwarmState


def _empty_swarm_state(task_requirement: str) -> GlobalSwarmState:
    return {
        "task_requirement": task_requirement,
        "architecture_draft": "",
        "architecture_json": {},
        "component_list": [],
        "current_architecture_mermaid": "",
        "complexity_score": 0,
        "diagram_plan": [],
        "doc_plan": [],
        "deep_dive_notes": "",
        "generated_diagrams": [],
    }


class SwarmGraphService:
    """Compiles the swarm graph once; invoke/resume go through the checkpointer."""

    def __init__(self) -> None:
        self._graph = GraphBuilder().build_graph()

    def run(self, task_requirement: str, thread_id: str) -> dict[str, Any]:
        return self._graph.invoke(
            _empty_swarm_state(task_requirement),
            config=swarm_config(thread_id),
        )

    def resume(self, thread_id: str) -> dict[str, Any]:
        return self._graph.invoke(None, config=swarm_config(thread_id))

    def get_checkpoint(self, thread_id: str) -> dict[str, Any]:
        snapshot = self._graph.get_state(swarm_config(thread_id))
        return build_checkpoint_payload(thread_id, snapshot)
