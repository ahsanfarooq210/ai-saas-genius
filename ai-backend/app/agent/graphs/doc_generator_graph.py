"""Doc sub-graph: plan → parallel Markdown workers → reduce."""

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent.state.schema import DocGraphState
from app.agent.subagents.artifact_reset import prepare_doc_artifacts_node
from app.agent.subagents.doc_planner import doc_planner_node
from app.agent.subagents.document_generator_worker import document_generator_node
from app.agent.subagents.reduce_docs import reduce_docs_node


def build_doc_generator_graph() -> CompiledStateGraph[DocGraphState]:
    builder = StateGraph(DocGraphState)

    builder.add_node("prepare_doc_artifacts_node", prepare_doc_artifacts_node)
    builder.add_node("document_generator_node", document_generator_node)
    builder.add_node("reduce_docs_node", reduce_docs_node)

    builder.add_edge(START, "prepare_doc_artifacts_node")
    builder.add_conditional_edges("prepare_doc_artifacts_node", doc_planner_node)
    builder.add_edge("document_generator_node", "reduce_docs_node")
    builder.add_edge("reduce_docs_node", END)

    return builder.compile()


doc_generator_graph = build_doc_generator_graph()
