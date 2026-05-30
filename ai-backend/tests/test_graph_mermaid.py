"""LangGraph Mermaid export registry (no LLM calls)."""

import pytest

from app.agent.graph_mermaid import (
    UnknownSwarmGraphError,
    list_swarm_graphs,
    render_swarm_graph_mermaid,
)


def test_list_swarm_graphs_registry() -> None:
    graphs = list_swarm_graphs()
    ids = {item["graph_id"] for item in graphs}
    assert ids == {"supervisor", "architect", "doc_generator"}


def test_render_unknown_graph_raises() -> None:
    with pytest.raises(UnknownSwarmGraphError):
        render_swarm_graph_mermaid("not-a-graph")


def test_render_supervisor_mermaid_non_empty() -> None:
    mermaid = render_swarm_graph_mermaid("supervisor")
    assert mermaid.strip()
    assert "supervisor_node" in mermaid or "__start__" in mermaid
