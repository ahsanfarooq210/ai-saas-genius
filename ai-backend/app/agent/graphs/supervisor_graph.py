"""Parent topology. Phase 9: cyclic supervisor with conditional routing."""

from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent.graphs.architect_graph import architect_graph
from app.agent.graphs.doc_generator_graph import doc_generator_graph
from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.scalability_expert import scalability_node
from app.agent.subagents.security_auditor import security_node
from app.agent.subagents.supervisor_router import supervisor_node, supervisor_route


class SupervisorGraph:
    """Parent graph — sub-graphs register as opaque nodes; owns the checkpointer."""

    def build(
        self,
        *,
        checkpointer: Any | None = None,
    ) -> CompiledStateGraph[GlobalSwarmState]:
        builder = StateGraph(GlobalSwarmState)

        builder.add_node("supervisor_node", supervisor_node)
        builder.add_node("architect_graph", architect_graph)
        builder.add_node("doc_generator_graph", doc_generator_graph)
        builder.add_node("scalability_node", scalability_node)
        builder.add_node("security_node", security_node)

        builder.add_edge(START, "supervisor_node")

        builder.add_conditional_edges(
            "supervisor_node",
            supervisor_route,
            {
                "architect_graph": "architect_graph",
                "doc_generator_graph": "doc_generator_graph",
                "scalability_node": "scalability_node",
                "security_node": "security_node",
                "END": END,
            },
        )

        builder.add_edge("architect_graph", "supervisor_node")
        builder.add_edge("doc_generator_graph", "supervisor_node")
        builder.add_edge("scalability_node", "supervisor_node")
        builder.add_edge("security_node", "supervisor_node")

        return builder.compile(checkpointer=checkpointer)


def build_supervisor_graph(checkpointer: Any) -> CompiledStateGraph[GlobalSwarmState]:
    """Compile the runtime parent graph with the app-managed checkpointer."""
    return SupervisorGraph().build(checkpointer=checkpointer)


# Checkpoint-free graph for topology rendering and tests that do not execute runtime state.
supervisor_graph = SupervisorGraph().build()
