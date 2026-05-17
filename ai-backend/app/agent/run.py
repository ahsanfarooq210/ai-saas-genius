"""Compile the swarm graph (used by SwarmGraphService and the API)."""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.agent.router.supervisor_router import route_after_complexity
from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.comlexity_analyzer import ComplexityAnalyzer
from app.agent.subagents.deep_dive import DeepDive
from app.agent.subagents.lead_architect import LeadArchitect
from app.agent.subagents.summarize import Summarize


def swarm_config(thread_id: str) -> dict:
    """LangGraph checkpointer config — same thread_id resumes the same checkpoint."""
    return {"configurable": {"thread_id": thread_id}}


class GraphBuilder:
    def build_graph(self):
        builder = StateGraph(GlobalSwarmState)

        builder.add_node(
            "draft_architecture_node", LeadArchitect().draft_architecture_node
        )
        builder.add_node(
            "score_complexity_node", ComplexityAnalyzer().score_complexity_node
        )
        builder.add_node("deep_dive_node", DeepDive().deep_dive_node)
        builder.add_node("summarize_node", Summarize().summarize_node)

        builder.add_edge(START, "draft_architecture_node")
        builder.add_edge("draft_architecture_node", "score_complexity_node")

        builder.add_conditional_edges(
            "score_complexity_node",
            route_after_complexity,
            {
                "deep_dive": "deep_dive_node",
                "summarize": "summarize_node",
            },
        )

        builder.add_edge("deep_dive_node", "summarize_node")
        builder.add_edge("summarize_node", END)

        return builder.compile(checkpointer=MemorySaver())
