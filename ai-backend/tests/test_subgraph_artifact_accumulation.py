"""Regression tests for artifact accumulation across compiled sub-graph boundaries."""

from __future__ import annotations

from typing import Any, cast

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agent.state.schema import (
    ArchitectGraphState,
    DiagramEntry,
    DiagramWorkerState,
    DocEntry,
    DocGraphState,
    DocWorkerState,
    GlobalSwarmState,
)
from app.agent.subagents.artifact_reset import (
    prepare_architect_artifacts_node,
    prepare_doc_artifacts_node,
)
from app.agent.subagents.reduce_diagrams import reduce_diagrams_node
from app.agent.subagents.reduce_docs import reduce_docs_node
from app.agent.subagents.reviewer_common import append_debate_log


def _base_global_state(**overrides: Any) -> GlobalSwarmState:
    state: dict[str, Any] = {
        "task_requirement": "Design a secure publishing platform",
        "revision_number": 1,
        "revision_instruction": "",
        "revision_pending": False,
        "architecture_draft": "",
        "architecture_json": {},
        "component_list": [],
        "current_architecture_mermaid": "",
        "complexity_score": 0,
        "diagram_plan": [],
        "doc_plan": [],
        "deep_dive_notes": "",
        "generated_diagrams": [],
        "thread_id": "thread-1",
        "generated_docs": [],
        "docs_complete": False,
        "iteration_count": 0,
        "next_agent": "",
        "scalability_feedback": "",
        "security_feedback": "",
        "debate_logs": [],
    }
    state.update(overrides)
    return cast(GlobalSwarmState, state)


def _architect_seed_node(state: ArchitectGraphState) -> dict[str, Any]:
    rejected = "REJECTED" in state.get("scalability_feedback", "")
    if rejected:
        return {
            "architecture_json": {"Token Vault": {"description": "isolated", "relations": []}},
            "component_list": ["Token Vault"],
            "diagram_plan": ["overview", "component-token-vault"],
            "iteration_count": 4,
            "scalability_feedback": "",
            "security_feedback": "",
        }

    return {
        "architecture_json": {"API Gateway": {"description": "public edge", "relations": []}},
        "component_list": ["API Gateway"],
        "diagram_plan": ["overview", "component-api-gateway"],
        "iteration_count": 1,
    }


def _architect_plan_workers(state: ArchitectGraphState) -> list[Send]:
    return [
        Send(
            "diagram_worker_node",
            DiagramWorkerState(
                diagram_type=entry,
                component_slug=entry.removeprefix("component-") if entry.startswith("component-") else "",
                task_requirement=state["task_requirement"],
                revision_number=state.get("revision_number", 1),
                revision_instruction=state.get("revision_instruction", ""),
                architecture_json=state["architecture_json"],
                draft_mermaid="",
                linter_errors=[],
                internal_loop_count=0,
                thread_id=state["thread_id"],
                iteration=state["iteration_count"],
            ),
        )
        for entry in state["diagram_plan"]
    ]


def _diagram_worker_node(state: DiagramWorkerState) -> dict[str, list[DiagramEntry]]:
    return {
        "generated_diagrams": [
            DiagramEntry(
                diagram_type=state["diagram_type"],
                component_slug=state["component_slug"],
                storage_key=(
                    f"swarm-artifacts/{state['thread_id']}/revisions/"
                    f"{state['revision_number']}/diagrams/"
                    f"iter{state['iteration']}_{state['diagram_type']}.mmd"
                ),
                url=(
                    "https://cdn.example/"
                    f"{state['thread_id']}/iter{state['iteration']}_{state['diagram_type']}.mmd"
                ),
                iteration=state["iteration"],
            )
        ]
    }


def _doc_seed_node(state: DocGraphState) -> dict[str, list[str]]:
    filenames = ["overview.md"]
    filenames.extend(f"{diagram['component_slug']}.md" for diagram in state["generated_diagrams"] if diagram["component_slug"])
    return {"doc_plan": filenames}


def _doc_plan_workers(state: DocGraphState) -> list[Send]:
    return [
        Send(
            "doc_worker_node",
            DocWorkerState(
                doc_filename=filename,
                component_slug="" if filename == "overview.md" else filename.removesuffix(".md"),
                task_requirement=state["task_requirement"],
                revision_number=state.get("revision_number", 1),
                revision_instruction=state.get("revision_instruction", ""),
                architecture_json=state["architecture_json"],
                generated_diagrams=state["generated_diagrams"],
                thread_id=state["thread_id"],
                iteration=state["iteration_count"],
            ),
        )
        for filename in state["doc_plan"]
    ]


def _doc_worker_node(state: DocWorkerState) -> dict[str, list[DocEntry]]:
    return {
        "generated_docs": [
            DocEntry(
                title=state["doc_filename"],
                component_slug=state["component_slug"],
                storage_key=(
                    f"swarm-artifacts/{state['thread_id']}/revisions/"
                    f"{state['revision_number']}/docs/{state['doc_filename']}"
                ),
                url=f"https://cdn.example/{state['thread_id']}/{state['doc_filename']}",
            )
        ]
    }


def _reject_scalability_node(state: GlobalSwarmState) -> dict[str, Any]:
    feedback = "Token storage is not isolated.\n\nSTATUS: REJECTED"
    return {
        "scalability_feedback": feedback,
        "debate_logs": append_debate_log(
            state,
            agent="scalability",
            feedback=feedback,
            status="REJECTED",
            iteration=3,
        ),
    }


def _build_architect_subgraph() -> Any:
    builder = StateGraph(ArchitectGraphState)
    builder.add_node("prepare", prepare_architect_artifacts_node)
    builder.add_node("seed", _architect_seed_node)
    builder.add_node("diagram_worker_node", _diagram_worker_node)
    builder.add_node("reduce", reduce_diagrams_node)
    builder.add_edge(START, "prepare")
    builder.add_edge("prepare", "seed")
    builder.add_conditional_edges("seed", _architect_plan_workers)
    builder.add_edge("diagram_worker_node", "reduce")
    builder.add_edge("reduce", END)
    return builder.compile()


def _build_doc_subgraph() -> Any:
    builder = StateGraph(DocGraphState)
    builder.add_node("prepare", prepare_doc_artifacts_node)
    builder.add_node("seed", _doc_seed_node)
    builder.add_node("doc_worker_node", _doc_worker_node)
    builder.add_node("reduce", reduce_docs_node)
    builder.add_edge(START, "prepare")
    builder.add_edge("prepare", "seed")
    builder.add_conditional_edges("seed", _doc_plan_workers)
    builder.add_edge("doc_worker_node", "reduce")
    builder.add_edge("reduce", END)
    return builder.compile()


def test_compiled_doc_subgraph_does_not_duplicate_parent_diagrams() -> None:
    architect_subgraph = _build_architect_subgraph()
    doc_subgraph = _build_doc_subgraph()

    builder = StateGraph(GlobalSwarmState)
    builder.add_node("architect_graph", architect_subgraph)
    builder.add_node("doc_graph", doc_subgraph)
    builder.add_edge(START, "architect_graph")
    builder.add_edge("architect_graph", "doc_graph")
    builder.add_edge("doc_graph", END)
    graph = builder.compile()

    result = graph.invoke(_base_global_state())

    assert [entry["diagram_type"] for entry in result["generated_diagrams"]] == [
        "overview",
        "component-api-gateway",
    ]
    assert len(result["generated_diagrams"]) == 2
    assert len(result["generated_docs"]) == 2
    assert [entry["title"] for entry in result["generated_docs"]] == [
        "overview.md",
        "api-gateway.md",
    ]


def test_architect_rerun_replaces_artifacts_without_log_duplication() -> None:
    architect_subgraph = _build_architect_subgraph()
    doc_subgraph = _build_doc_subgraph()

    builder = StateGraph(GlobalSwarmState)
    builder.add_node("architect_graph_first", architect_subgraph)
    builder.add_node("architect_graph_second", architect_subgraph)
    builder.add_node("doc_graph", doc_subgraph)
    builder.add_node("reject_scalability", _reject_scalability_node)
    builder.add_edge(START, "architect_graph_first")
    builder.add_edge("architect_graph_first", "doc_graph")
    builder.add_edge("doc_graph", "reject_scalability")
    builder.add_edge("reject_scalability", "architect_graph_second")
    builder.add_edge("architect_graph_second", END)
    graph = builder.compile()

    result = graph.invoke(_base_global_state())

    assert [entry["diagram_type"] for entry in result["generated_diagrams"]] == [
        "overview",
        "component-token-vault",
    ]
    assert {entry["iteration"] for entry in result["generated_diagrams"]} == {4}
    assert result["generated_docs"] == []
    assert len(result["debate_logs"]) == 1
    assert result["debate_logs"][0]["agent"] == "scalability"
    assert result["scalability_feedback"] == ""
