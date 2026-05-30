from typing import Any

from app.agent.graph_mermaid import (
    UnknownSwarmGraphError,
    list_swarm_graphs,
    render_swarm_graph_mermaid,
)
from app.agent.run import GraphBuilder, build_checkpoint_payload, swarm_config
from app.agent.state.schema import GlobalSwarmState


def _empty_swarm_state(task_requirement: str, thread_id: str) -> GlobalSwarmState:
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
        "thread_id": thread_id,
        "generated_docs": [],
        "docs_complete": False,
        "iteration_count": 0,
        "next_agent": "",
        "scalability_feedback": "",
        "security_feedback": "",
        "debate_logs": [],
    }


class SwarmGraphService:
    """Compiles the swarm graph once; invoke/resume go through the checkpointer."""

    def __init__(self) -> None:
        self._graph = GraphBuilder().build_graph()

    def run(self, task_requirement: str, thread_id: str) -> dict[str, Any]:
        return self._graph.invoke(
            _empty_swarm_state(task_requirement, thread_id),
            config=swarm_config(thread_id),
        )

    def resume(self, thread_id: str) -> dict[str, Any]:
        return self._graph.invoke(None, config=swarm_config(thread_id))

    def get_checkpoint(self, thread_id: str) -> dict[str, Any]:
        snapshot = self._graph.get_state(swarm_config(thread_id))
        return build_checkpoint_payload(thread_id, snapshot)

    def list_graphs(self) -> list[dict[str, str | bool]]:
        return list_swarm_graphs()

    def get_graph_mermaid(self, graph_id: str, *, xray: bool = False) -> dict[str, Any]:
        try:
            mermaid = render_swarm_graph_mermaid(graph_id, xray=xray)
        except UnknownSwarmGraphError as exc:
            raise ValueError(str(exc)) from exc
        return {"graph_id": graph_id, "mermaid": mermaid, "xray": xray}
