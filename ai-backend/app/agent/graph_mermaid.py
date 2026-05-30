"""LangGraph topology → Mermaid (via compiled graph drawable)."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from langgraph.graph.state import CompiledStateGraph

from app.agent.graphs.architect_graph import architect_graph
from app.agent.graphs.doc_generator_graph import doc_generator_graph
from app.agent.graphs.supervisor_graph import supervisor_graph
from app.agent.state.schema import GlobalSwarmState

SwarmCompiledGraph = CompiledStateGraph[GlobalSwarmState]


class SwarmGraphRegistryEntry(TypedDict):
    name: str
    description: str
    get_compiled: Callable[[], SwarmCompiledGraph]
    supports_xray: bool


_GRAPH_REGISTRY: dict[str, SwarmGraphRegistryEntry] = {
    "supervisor": {
        "name": "Supervisor (parent)",
        "description": (
            "Parent graph: supervisor routing, architect and doc sub-graphs, "
            "scalability and security reviewers."
        ),
        "get_compiled": lambda: supervisor_graph,
        "supports_xray": True,
    },
    "architect": {
        "name": "Architect sub-graph",
        "description": (
            "Draft architecture → complexity scoring → diagram fan-out → reduce."
        ),
        "get_compiled": lambda: architect_graph,
        "supports_xray": False,
    },
    "doc_generator": {
        "name": "Document generator sub-graph",
        "description": "Doc plan fan-out → parallel Markdown workers → reduce.",
        "get_compiled": lambda: doc_generator_graph,
        "supports_xray": False,
    },
}


class UnknownSwarmGraphError(KeyError):
    """Raised when graph_id is not in the registry."""


def list_swarm_graphs() -> list[dict[str, str | bool]]:
    """Metadata for GET /swarm/graphs."""
    return [
        {
            "graph_id": graph_id,
            "name": entry["name"],
            "description": entry["description"],
            "supports_xray": entry["supports_xray"],
        }
        for graph_id, entry in _GRAPH_REGISTRY.items()
    ]


def render_swarm_graph_mermaid(graph_id: str, *, xray: bool = False) -> str:
    """Return Mermaid source for a registered compiled graph."""
    entry = _GRAPH_REGISTRY.get(graph_id)
    if entry is None:
        raise UnknownSwarmGraphError(graph_id)

    compiled = entry["get_compiled"]()
    use_xray = xray and entry["supports_xray"]
    drawable = compiled.get_graph(xray=use_xray)
    return drawable.draw_mermaid()
