"""Architect sub-graph. Phase 5: draft architecture → score complexity."""

from langgraph.graph import END, START, StateGraph

from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.comlexity_analyzer import ComplexityAnalyzer
from app.agent.subagents.lead_architect import LeadArchitect


class ArchitectGraph:
    """Compiled independently; parent registers it as a single opaque node."""

    def __init__(self) -> None:
        self._lead_architect = LeadArchitect()
        self._complexity_analyzer = ComplexityAnalyzer()

    def build(self):
        builder = StateGraph(GlobalSwarmState)

        builder.add_node(
            "draft_architecture_node",
            self._lead_architect.draft_architecture_node,
        )
        builder.add_node(
            "score_complexity_node",
            self._complexity_analyzer.score_complexity_node,
        )

        builder.add_edge(START, "draft_architecture_node")
        builder.add_edge("draft_architecture_node", "score_complexity_node")
        builder.add_edge("score_complexity_node", END)

        return builder.compile()


architect_graph = ArchitectGraph().build()
