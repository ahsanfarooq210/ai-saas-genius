from langgraph.types import Send

from app.agent.state.schema import ArchitectGraphState, DiagramWorkerState


def diagram_planner_node(state: ArchitectGraphState) -> list[Send]:
    """
    Returns list[Send] — NOT a state dict.
    Each Send triggers one isolated diagram_generator_node invocation.
    The number of workers = len(diagram_plan), unknown until runtime.
    """
    print(f"\n[diagram_planner] fanning out {len(state['diagram_plan'])} workers")

    return [
        Send(
            "diagram_generator_node",  # must match node name exactly in architect_graph
            DiagramWorkerState(
                diagram_type=entry,
                component_slug=_slug_from_entry(entry),
                task_requirement=state["task_requirement"],
                architecture_json=state["architecture_json"],
                draft_mermaid="",
                linter_errors=[],
                internal_loop_count=0,
                thread_id=state.get("thread_id") or "default",
                iteration=state.get("iteration_count", 1),
            ),
        )
        for entry in state["diagram_plan"]
    ]


def _slug_from_entry(entry: str) -> str:
    """
    Extract component slug from a diagram_plan entry.
    "component-api-gateway" → "api-gateway"
    "overview"              → ""
    "auth-flow"             → ""   (cross-cutting, not component-scoped)
    """
    if entry.startswith("component-"):
        return entry[len("component-") :]
    return ""
