from typing import Any

import langgraph.types as langgraph_types

from app.agent.state.schema import DocGraphState

_overwrite = getattr(langgraph_types, "Overwrite")


def reduce_docs_node(state: DocGraphState) -> dict[str, Any]:
    """
    Runs after ALL parallel document_generator_node workers complete.
    Sets docs_complete — explicit signal for Phase 9 supervisor routing.

    The doc subgraph uses operator.add only while workers are running in
    parallel. At fan-in, Overwrite turns those worker appends into one final
    replacement list for the parent graph.
    """
    all_docs = state.get("generated_docs") or []

    print(f"\n[reduce_docs] collected {len(all_docs)} documents")
    for doc in all_docs:
        slug = doc["component_slug"] or "(cross-cutting)"
        print(f"  ✓ {doc['title']:<45} slug={slug}")

    return {
        "generated_docs": _overwrite(all_docs),
        "docs_complete": True,
    }
