from typing import Any

import langgraph.types as langgraph_types

from app.agent.state.schema import ArchitectGraphState, DocGraphState

_overwrite = getattr(langgraph_types, "Overwrite")


def prepare_architect_artifacts_node(state: ArchitectGraphState) -> dict[str, Any]:
    """Clear diagram/doc artifacts before each architect sub-graph run."""
    return {
        "generated_diagrams": _overwrite([]),
        "generated_docs": [],
        "docs_complete": False,
    }


def prepare_doc_artifacts_node(state: DocGraphState) -> dict[str, Any]:
    """Clear docs before each doc-generation sub-graph run."""
    return {
        "generated_docs": _overwrite([]),
        "docs_complete": False,
    }
