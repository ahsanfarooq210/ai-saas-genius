"""Architect sub-graph: draft → complexity → parallel diagrams → reduce.

Registered in the parent graph as the opaque node `"architect_graph"`. Each time
the supervisor routes here, this subgraph runs start-to-finish and returns updated
state (especially `component_list`, `architecture_json`, `diagram_plan`, `doc_plan`,
and `generated_diagrams`) back to `supervisor_node`.

Topology
--------
::

    START
      → prepare_architect_artifacts_node   # reset stale artifacts on reruns
      → draft_architecture_node            # LeadArchitect (structured LLM)
      → score_complexity_node              # ComplexityAnalyzer (structured LLM)
      → diagram_planner_node               # conditional router — NOT add_node'd
          └─ Send × len(diagram_plan) → diagram_generator_node  (parallel)
      → reduce_diagrams_node               # barrier after all workers finish
      → END

State and merge behavior
------------------------
Uses `ArchitectGraphState`, a subgraph view of `GlobalSwarmState`. The key
difference is `generated_diagrams: Annotated[list, operator.add]` — parallel
`Send` workers each append one `DiagramEntry`, and `reduce_diagrams_node`
replaces the accumulated list with validated entries via `Overwrite`.

`doc_plan` is written here but docs are generated later by `doc_generator_graph`
when the supervisor sees `docs_complete` is False.

This file owns topology only. Prompts, LLM calls, and per-node logic live under
`app/agent/subagents/`.
"""

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
    """Compile the architect subgraph.

    Node responsibilities
    ---------------------
    prepare_architect_artifacts_node
        Clears `generated_diagrams`, `generated_docs`, and sets `docs_complete`
        False before each run so a supervisor re-route (e.g. after reviewer
        rejection) does not keep stale artifacts.

    draft_architecture_node
        Produces `architecture_json`, `component_list`, and
        `current_architecture_mermaid`. On revision laps, injects rejected
        scalability/security feedback into the prompt.

    score_complexity_node
        Sets `complexity_score`, `diagram_plan`, and `doc_plan` from the draft.

    diagram_planner_node (conditional edge only)
        Reads `diagram_plan` and returns `list[Send]` — one isolated
        `DiagramWorkerState` per entry. Worker count is unknown at compile time.

    diagram_generator_node
        Each Send invocation generates, lints, and stores one diagram; appends
        a single `DiagramEntry` to subgraph `generated_diagrams`.

    reduce_diagrams_node
        Barrier node: runs only after every Send worker completes. Drops entries
        missing `storage_key`/`url`, then overwrites `generated_diagrams` with
        the valid subset so parent state does not accumulate duplicates.
    """
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

    # Fan-out: diagram_planner_node is the conditional-edge router (not add_node'd).
    # It returns list[Send], one per diagram_plan entry; LangGraph runs workers
    # in parallel, each with isolated DiagramWorkerState.
    builder.add_conditional_edges(
        "score_complexity_node",
        diagram_planner_node,
    )

    # Fan-in: reduce runs once after ALL Send workers return.
    builder.add_edge("diagram_generator_node", "reduce_diagrams_node")
    builder.add_edge("reduce_diagrams_node", END)

    return builder.compile()


# Module-level compiled graph — imported by supervisor_graph as an opaque node.
architect_graph = build_architect_graph()
