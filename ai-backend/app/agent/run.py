from langgraph.graph import END, START, StateGraph

from app.agent.router.supervisor_router import route_after_complexity
from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.comlexity_analyzer import ComplexityAnalyzer
from app.agent.subagents.deep_dive import DeepDive
from app.agent.subagents.lead_architect import LeadArchitect
from app.agent.subagents.summarize import Summarize


class GraphBuilder:
    def __init__(self):
        self.graph = None

    def build_graph(self):
        builder = StateGraph(GlobalSwarmState)

        # ── Nodes ──────────────────────────────────────────────
        builder.add_node(
            "draft_architecture_node", LeadArchitect().draft_architecture_node
        )
        builder.add_node(
            "score_complexity_node", ComplexityAnalyzer().score_complexity_node
        )
        builder.add_node("deep_dive_node", DeepDive().deep_dive_node)
        builder.add_node("summarize_node", Summarize().summarize_node)

        # ── Fixed edges ────────────────────────────────────────
        builder.add_edge(START, "draft_architecture_node")
        builder.add_edge("draft_architecture_node", "score_complexity_node")

        # ── Conditional edge ───────────────────────────────────
        # route_after_complexity() returns "deep_dive" or "summarize"
        # the dict maps those strings to actual node names
        builder.add_conditional_edges(
            "score_complexity_node",
            route_after_complexity,
            {
                "deep_dive": "deep_dive_node",
                "summarize": "summarize_node",
            },
        )

        # ── deep_dive always flows into summarize ──────────────
        builder.add_edge("deep_dive_node", "summarize_node")
        builder.add_edge("summarize_node", END)

        self.graph = builder.compile()
        return self.graph
