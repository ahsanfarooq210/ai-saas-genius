from enum import Enum
from typing import Any

from langgraph.graph import END, StateGraph

from app.agent.review_parsing import terminal_review_status
from app.agent.state.global_swarm_state import GlobalSwarmState
from app.agent.streaming import emit_custom_event
from app.agent.subagents.architect import architect_graph
from app.agent.subagents.doc_generator import doc_generator_graph
from app.agent.nodes.scalability_expert import scalability_node
from app.agent.nodes.security_auditor import security_node


# ─────────────────────────────────────────────────────────────────────────────
# SUPERVISOR NODE
# ─────────────────────────────────────────────────────────────────────────────


class NextAgent(str, Enum):
    architect = "architect_graph"
    docs = "doc_generator_graph"
    scalability = "scalability_node"
    security = "security_node"
    end = "END"


async def supervisor_node(state: GlobalSwarmState) -> dict:
    # Routing evaluated strictly in priority order
    iteration = state.get("iteration_count", 0) + 1

    if iteration == 1:
        emit_custom_event(
            {
                "event": "workflow_started",
                "type": "progress",
                "stage": "supervisor",
                "status": "started",
                "message": "Architecture swarm started",
            }
        )

    if iteration > 5:
        emit_custom_event(
            {
                "event": "workflow_completed",
                "type": "progress",
                "stage": "done",
                "status": "completed",
                "message": "Workflow completed (iteration limit)",
            }
        )
        return {
            "next_agent": NextAgent.end,
            "iteration_count": iteration,
            "current_stage": "done",
            "current_task": "Finished",
            "progress_message": "Workflow completed",
        }

    if not state.get("current_architecture_mermaid"):
        return {
            "next_agent": NextAgent.architect,
            "iteration_count": iteration,
            "current_stage": "architect",
            "current_task": "Designing architecture",
            "progress_message": "Creating system architecture and complexity analysis",
        }

    if not state.get("docs_complete"):
        return {
            "next_agent": NextAgent.docs,
            "iteration_count": iteration,
            "current_stage": "docs",
            "current_task": "Generating documentation",
            "progress_message": "Creating markdown documentation files",
        }

    scalability_feedback = state.get("scalability_feedback", "")
    if terminal_review_status(scalability_feedback) != "approved":
        return {
            "next_agent": NextAgent.scalability,
            "iteration_count": iteration,
            "current_stage": "scalability",
            "current_task": "Running scalability review",
            "progress_message": "Reviewing architecture for bottlenecks and SPOFs",
        }

    security_feedback = state.get("security_feedback", "")
    if terminal_review_status(security_feedback) != "approved":
        return {
            "next_agent": NextAgent.security,
            "iteration_count": iteration,
            "current_stage": "security",
            "current_task": "Running security review",
            "progress_message": "Auditing architecture for security risks",
        }

    emit_custom_event(
        {
            "event": "workflow_completed",
            "type": "progress",
            "stage": "done",
            "status": "completed",
            "message": "All reviews approved",
        }
    )
    return {
        "next_agent": NextAgent.end,
        "iteration_count": iteration,
        "current_stage": "done",
        "current_task": "Finished",
        "progress_message": "All reviews approved",
    }


def route_supervisor(state: GlobalSwarmState) -> str:
    """
    Conditional edge function — reads next_agent set by supervisor_node
    and returns the name of the next node to route to.
    """
    return state.get("next_agent", NextAgent.end)


# ─────────────────────────────────────────────────────────────────────────────
# PARENT GRAPH ASSEMBLY
# ─────────────────────────────────────────────────────────────────────────────


def build_swarm_graph(checkpointer: Any = None):
    graph = StateGraph(GlobalSwarmState)

    # ── Register nodes ────────────────────────────────────────────────────────
    graph.add_node("supervisor_node", supervisor_node)
    graph.add_node("architect_graph", architect_graph)
    graph.add_node("doc_generator_graph", doc_generator_graph)
    graph.add_node("scalability_node", scalability_node)
    graph.add_node("security_node", security_node)

    # ── Entry point ───────────────────────────────────────────────────────────
    graph.set_entry_point("supervisor_node")

    # ── Supervisor conditional edge ───────────────────────────────────────────
    graph.add_conditional_edges(
        "supervisor_node",
        route_supervisor,
        {
            NextAgent.architect: "architect_graph",
            NextAgent.docs: "doc_generator_graph",
            NextAgent.scalability: "scalability_node",
            NextAgent.security: "security_node",
            NextAgent.end: END,
        },
    )

    # ── All workers return to supervisor ─────────────────────────────────────
    graph.add_edge("architect_graph", "supervisor_node")
    graph.add_edge("doc_generator_graph", "supervisor_node")
    graph.add_edge("scalability_node", "supervisor_node")
    graph.add_edge("security_node", "supervisor_node")

    return graph.compile(checkpointer=checkpointer)
