import sys
from typing import TypedDict

from langgraph.graph import StateGraph, START, END
from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.lead_architect import LeadArchitect


class GraphBuilder:

    def __init__(self):
        self.graph = None

    def build_graph(self):
        lead_architect_node=LeadArchitect()
        builder = StateGraph(GlobalSwarmState)
        builder.add_node("lead_architect", lead_architect_node.draft_architecture_node)
        builder.add_edge(START, "lead_architect")
        builder.add_edge("lead_architect", END)
        self.graph = builder.compile()
        return self.graph
