"""Doc sub-graph: plan → parallel Markdown workers → reduce.

Registered in the parent graph as the opaque node `"doc_generator_graph"`. The
supervisor routes here when `component_list` is populated but `docs_complete`
is False — typically after `architect_graph` has produced `doc_plan` and
`generated_diagrams`.

Topology
--------
::

    START
      → prepare_doc_artifacts_node   # reset stale docs on reruns
      → doc_planner_node             # conditional router — NOT add_node'd
          └─ Send × len(doc_plan) → document_generator_node  (parallel)
      → reduce_docs_node             # barrier; sets docs_complete = True
      → END

State and merge behavior
------------------------
Uses `DocGraphState`, a subgraph view of `GlobalSwarmState`. Like the architect
graph, `generated_docs` is `Annotated[list, operator.add]` so parallel Send
workers each append one `DocEntry`; `reduce_docs_node` overwrites the list and
sets `docs_complete` True — the gate the supervisor checks before routing to
reviewer nodes.

`doc_plan` is produced upstream by `score_complexity_node` in `architect_graph`.
Each worker receives a copy of `generated_diagrams` so component docs can link
to paired Mermaid assets.

This file owns topology only. Prompts, LLM calls, and per-node logic live under
`app/agent/subagents/`.
"""

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent.state.schema import DocGraphState
from app.agent.subagents.artifact_reset import prepare_doc_artifacts_node
from app.agent.subagents.doc_planner import doc_planner_node
from app.agent.subagents.document_generator_worker import document_generator_node
from app.agent.subagents.reduce_docs import reduce_docs_node


def build_doc_generator_graph() -> CompiledStateGraph[DocGraphState]:
    """Compile the documentation subgraph.

    Node responsibilities
    ---------------------
    prepare_doc_artifacts_node
        Clears `generated_docs` and sets `docs_complete` False before each run
        so a supervisor re-route does not keep stale Markdown artifacts.

    doc_planner_node (conditional edge only)
        Reads `doc_plan` (from architect phase) and returns `list[Send]` — one
        isolated `DocWorkerState` per filename. Worker count is unknown at
        compile time.

    document_generator_node
        Each Send invocation generates one Markdown doc via LLM, stores it,
        and appends a single `DocEntry` to subgraph `generated_docs`.

    reduce_docs_node
        Barrier node: runs only after every Send worker completes. Overwrites
        `generated_docs` with the collected entries and sets `docs_complete`
        True so `_route` in the supervisor can advance to reviewer nodes.
    """
    builder = StateGraph(DocGraphState)

    builder.add_node("prepare_doc_artifacts_node", prepare_doc_artifacts_node)
    builder.add_node("document_generator_node", document_generator_node)
    builder.add_node("reduce_docs_node", reduce_docs_node)

    builder.add_edge(START, "prepare_doc_artifacts_node")

    # Fan-out: doc_planner_node is the conditional-edge router (not add_node'd).
    # It returns list[Send], one per doc_plan entry; LangGraph runs workers
    # in parallel, each with isolated DocWorkerState.
    builder.add_conditional_edges("prepare_doc_artifacts_node", doc_planner_node)

    # Fan-in: reduce runs once after ALL Send workers return.
    builder.add_edge("document_generator_node", "reduce_docs_node")
    builder.add_edge("reduce_docs_node", END)

    return builder.compile()


# Module-level compiled graph — imported by supervisor_graph as an opaque node.
doc_generator_graph = build_doc_generator_graph()
