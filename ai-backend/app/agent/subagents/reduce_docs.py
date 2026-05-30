from langgraph.types import Overwrite

from app.agent.state.schema import GlobalSwarmState


def reduce_docs_node(state: GlobalSwarmState) -> dict:
    """
    Runs after ALL parallel document_generator_node workers complete.
    Sets docs_complete — explicit signal for Phase 9 supervisor routing.
    """
    all_docs = state.get("generated_docs") or []

    print(f"\n[reduce_docs] collected {len(all_docs)} documents")
    for doc in all_docs:
        slug = doc["component_slug"] or "(cross-cutting)"
        print(f"  ✓ {doc['title']:<45} slug={slug}")

    return {
        "generated_docs": Overwrite(all_docs),
        "docs_complete": True,
    }
