from typing import Any

import langgraph.types as langgraph_types

from app.agent.state.schema import ArchitectGraphState, DiagramEntry

_overwrite = getattr(langgraph_types, "Overwrite")


def reduce_diagrams_node(state: ArchitectGraphState) -> dict[str, Any]:
    """
    Runs after ALL parallel diagram_generator_node workers complete.
    LangGraph starts this node only when every Send worker has returned.
    """
    all_diagrams: list[DiagramEntry] = state.get("generated_diagrams", [])
    valid_diagrams = [d for d in all_diagrams if d.get("storage_key") and d.get("url")]
    failed = [d for d in all_diagrams if not d.get("storage_key") or not d.get("url")]

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
    return {"generated_diagrams": _overwrite(valid_diagrams)}
