from langgraph.types import Send

from app.agent.state.schema import DocWorkerState, GlobalSwarmState


def slug_from_doc_filename(filename: str) -> str:
    """
    "api-gateway.md"  → "api-gateway"
    "overview.md"     → ""
    "adr-caching.md"  → ""   (cross-cutting)
    """
    name = filename.replace(".md", "")
    if name in ("overview",) or name.startswith("adr-") or name.startswith("runbook-"):
        return ""
    return name


def doc_planner_node(state: GlobalSwarmState) -> list[Send]:
    """
    Returns list[Send] — one per doc_plan entry.
    Each Send carries an isolated DocWorkerState with generated_diagrams for pairing.
    """
    print(f"\n[doc_planner] fanning out {len(state['doc_plan'])} workers")

    return [
        Send(
            "document_generator_node",
            DocWorkerState(
                doc_filename=filename,
                component_slug=slug_from_doc_filename(filename),
                task_requirement=state["task_requirement"],
                architecture_json=state["architecture_json"],
                generated_diagrams=state.get("generated_diagrams") or [],
                thread_id=state.get("thread_id") or "default",
                iteration=int(state.get("iteration_count", 1)),  # type: ignore[arg-type]
            ),
        )
        for filename in state["doc_plan"]
    ]
