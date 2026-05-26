"""Phase 6 reducer experiment: plain list overwrites, reducer appends."""

from typing import Annotated, TypedDict, get_args, get_origin, get_type_hints
import operator

from langgraph.graph import END, START, StateGraph

from app.agent.state.schema import DiagramEntry, GlobalSwarmState


class PlainListState(TypedDict):
    generated_diagrams: list[DiagramEntry]


class ReducedListState(TypedDict):
    generated_diagrams: Annotated[list[DiagramEntry], operator.add]


def _make_entry(diagram_type: str) -> DiagramEntry:
    return {
        "diagram_type": diagram_type,
        "component_slug": "",
        "content": f"flowchart TD\n    A[{diagram_type}]",
        "path": f"diagrams/test/iter1_{diagram_type}.mmd",
        "iteration": 1,
    }


def _first_writer(_: TypedDict) -> dict[str, list[DiagramEntry]]:
    return {"generated_diagrams": [_make_entry("overview")]}


def _second_writer(_: TypedDict) -> dict[str, list[DiagramEntry]]:
    return {"generated_diagrams": [_make_entry("auth-flow")]}


def _run_graph(state_schema: type[TypedDict]) -> dict:
    builder = StateGraph(state_schema)
    builder.add_node("first_writer", _first_writer)
    builder.add_node("second_writer", _second_writer)
    builder.add_edge(START, "first_writer")
    builder.add_edge("first_writer", "second_writer")
    builder.add_edge("second_writer", END)
    graph = builder.compile()
    return graph.invoke({"generated_diagrams": []})


def test_plain_list_keeps_only_last_writer() -> None:
    result = _run_graph(PlainListState)

    print("without reducer:", len(result["generated_diagrams"]), result["generated_diagrams"])

    assert len(result["generated_diagrams"]) == 1
    assert result["generated_diagrams"][0]["diagram_type"] == "auth-flow"


def test_reducer_appends_both_entries() -> None:
    result = _run_graph(ReducedListState)

    print("with reducer:", len(result["generated_diagrams"]), result["generated_diagrams"])

    assert len(result["generated_diagrams"]) == 2
    assert [entry["diagram_type"] for entry in result["generated_diagrams"]] == [
        "overview",
        "auth-flow",
    ]


def test_global_swarm_state_uses_reducer_for_generated_diagrams() -> None:
    hints = get_type_hints(GlobalSwarmState, include_extras=True)

    generated_diagrams = hints["generated_diagrams"]

    assert get_origin(generated_diagrams) is Annotated
    assert get_args(generated_diagrams)[0] == list[DiagramEntry]
    assert get_args(generated_diagrams)[1] is operator.add
