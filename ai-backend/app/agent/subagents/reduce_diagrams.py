from langgraph.types import Overwrite

from app.agent.state.schema import DiagramEntry, GlobalSwarmState


def reduce_diagrams_node(state: GlobalSwarmState) -> dict:
    """
    Runs after ALL parallel diagram_generator_node workers complete.
    LangGraph starts this node only when every Send worker has returned.
    """
    all_diagrams: list[DiagramEntry] = state.get("generated_diagrams", [])
    valid_diagrams = [d for d in all_diagrams if d["content"] != "syntax_error"]
    failed = [d for d in all_diagrams if d["content"] == "syntax_error"]

    print(
        f"\n[reduce_diagrams] total={len(all_diagrams)} "
        f"valid={len(valid_diagrams)} failed={len(failed)}"
    )

    if failed:
        print(
            "[reduce_diagrams] failed diagrams: "
            f"{[d['diagram_type'] for d in failed]}"
        )

    # Overwrite replaces the accumulated list; operator.add would duplicate entries.
    return {"generated_diagrams": Overwrite(valid_diagrams)}
