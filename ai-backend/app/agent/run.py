import sys
from typing import TypedDict

from langgraph.graph import StateGraph, START, END
from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.lead_architect import LeadArchitect
from app.agent.subagents.comlexity_analyzer import ComplexityAnalyzer


class GraphBuilder:

    def __init__(self):
        self.graph = None

    def build_graph(self):
        builder = StateGraph(GlobalSwarmState)
        builder.add_node(
            "draft_architecture_node", LeadArchitect().draft_architecture_node
        )
        builder.add_node(
            "score_complexity_node", ComplexityAnalyzer().score_complexity_node
        )
        builder.add_edge(START, "draft_architecture_node")
        builder.add_edge("draft_architecture_node", "score_complexity_node")
        builder.add_edge("score_complexity_node", END)
        self.graph = builder.compile()
        return self.graph
