"""Graph entry, thread config, and checkpoint shaping for the API layer."""

from __future__ import annotations

from typing import Any

from app.agent.state.schema import DiagramEntry, DocEntry

from app.agent.graphs.supervisor_graph import supervisor_graph


def swarm_config(thread_id: str) -> dict:
    """LangGraph checkpointer config — same thread_id resumes the same checkpoint."""
    return {"configurable": {"thread_id": thread_id}}


def diagram_checkpoint_items(
    diagrams: list[DiagramEntry] | None,
) -> list[dict[str, Any]]:
    """Summarize generated diagrams for GET /state (no full Mermaid bodies)."""
    items: list[dict[str, Any]] = []
    for entry in diagrams or []:
        items.append(
            {
                "diagram_type": entry["diagram_type"],
                "component_slug": entry.get("component_slug") or "",
                "valid": entry["content"] != "syntax_error",
                "path": entry.get("path") or "",
                "iteration": entry.get("iteration", 0),
            }
        )
    return items


def doc_checkpoint_items(docs: list[DocEntry] | None) -> list[dict[str, Any]]:
    """Summarize generated docs for GET /state (no full Markdown bodies)."""
    items: list[dict[str, Any]] = []
    for entry in docs or []:
        items.append(
            {
                "title": entry["title"],
                "component_slug": entry.get("component_slug") or "",
                "path": entry.get("path") or "",
            }
        )
    return items


def build_checkpoint_payload(thread_id: str, snapshot: Any) -> dict[str, Any]:
    """Shape a LangGraph StateSnapshot into the SwarmCheckpointResponse contract."""
    values: dict[str, Any] = dict(snapshot.values or {})
    diagrams: list[DiagramEntry] = values.get("generated_diagrams") or []
    docs: list[DocEntry] = values.get("generated_docs") or []

    return {
        "thread_id": thread_id,
        "next": snapshot.next or (),
        "component_list": values.get("component_list") or [],
        "complexity_score": values.get("complexity_score") or 0,
        "diagram_plan": values.get("diagram_plan") or [],
        "generated_diagram_count": len(diagrams),
        "generated_diagrams": diagram_checkpoint_items(diagrams),
        "generated_doc_count": len(docs),
        "generated_docs": doc_checkpoint_items(docs),
        "docs_complete": bool(values.get("docs_complete")),
        "iteration_count": int(values.get("iteration_count") or 0),
        "next_agent": values.get("next_agent") or "",
        "scalability_feedback": values.get("scalability_feedback") or "",
        "security_feedback": values.get("security_feedback") or "",
        "values": values,
    }


class GraphBuilder:
    """Returns the compiled parent graph; does not wire sub-graph nodes directly."""

    def __init__(self) -> None:
        self.graph = None

    def build_graph(self):
        self.graph = supervisor_graph
        return self.graph
