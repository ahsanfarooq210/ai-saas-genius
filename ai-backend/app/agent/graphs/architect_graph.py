"""Architect sub-graph: draft → complexity → parallel diagrams → reduce."""

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent.state.schema import ArchitectGraphState
from app.agent.subagents.artifact_reset import prepare_architect_artifacts_node
from app.agent.subagents.comlexity_analyzer import ComplexityAnalyzer
from app.agent.subagents.diagram_generator_worker import DiagramGenerator
from app.agent.subagents.diagram_planner import diagram_planner_node
from app.agent.subagents.lead_architect import LeadArchitect
from app.agent.subagents.reduce_diagrams import reduce_diagrams_node

# Subagent instances — prompts and LLM calls live in subagents/, not here.
_lead_architect = LeadArchitect()
_complexity_analyzer = ComplexityAnalyzer()
_diagram_generator = DiagramGenerator()


def build_architect_graph() -> CompiledStateGraph[ArchitectGraphState]:
    builder = StateGraph(ArchitectGraphState)

    builder.add_node(
        "prepare_architect_artifacts_node",
        prepare_architect_artifacts_node,
    )
    builder.add_node(
        "draft_architecture_node",
        _lead_architect.draft_architecture_node,
    )
    builder.add_node(
        "score_complexity_node",
        _complexity_analyzer.score_complexity_node,
    )
    builder.add_node(
        "diagram_generator_node",
        _diagram_generator.diagram_generator_node,
    )
    builder.add_node("reduce_diagrams_node", reduce_diagrams_node)

    builder.add_edge(START, "prepare_architect_artifacts_node")
    builder.add_edge("prepare_architect_artifacts_node", "draft_architecture_node")
    builder.add_edge("draft_architecture_node", "score_complexity_node")

    # score_complexity_node → diagram_planner_node → [Send × N]
    # diagram_planner_node is not add_node'd — it is the conditional-edge router.
    # Returning list[Send] fans out to diagram_generator_node in parallel.
    builder.add_conditional_edges(
        "score_complexity_node",
        diagram_planner_node,
    )

    # All parallel workers converge here after every Send completes.
    builder.add_edge("diagram_generator_node", "reduce_diagrams_node")
    builder.add_edge("reduce_diagrams_node", END)

    return builder.compile()


architect_graph = build_architect_graph()
