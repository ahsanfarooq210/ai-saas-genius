# graph/schema.py  (add these alongside GlobalSwarmState)
from typing import TypedDict, Annotated, Optional
import operator


class DocEntry(TypedDict):
    title: str  # human-readable title e.g. "Auth Service — Component Overview"
    content: str  # raw Markdown string
    path: str  # file store key e.g. "reports/{thread_id}/iter2_auth-service.md"


# graph/schema.py  (add alongside DocEntry and DocWorkerState)


class DiagramEntry(TypedDict):
    diagram_type: str  # controlled vocabulary: "overview" | "auth-flow" | "db-schema" |
    # "infra" | "data-pipeline" | "api-contracts" | "event-flow" | "deployment"
    content: str  # raw Mermaid string — set to "syntax_error" if linter failed 3x
    path: str  # file store key e.g. "diagrams/{thread_id}/iter2_overview.mmd"
    iteration: int  # which swarm iteration produced this diagram


class DocWorkerState(TypedDict):
    # ── Passed down from GlobalSwarmState via Send() ──────────────────────────
    doc_slug: str  # e.g. "auth-service.md" — which doc to write
    task_requirement: str  # original user prompt for context
    architecture_json: dict  # full component map
    component_list: list[str]  # ["API Gateway", "Auth Service", ...]
    generated_diagrams: list[
        DiagramEntry
    ]  # worker references relevant diagrams by name
    thread_id: str  # needed to build file store path
    iteration: int  # current swarm iteration number

    # ── Internal scratchpad — never surfaces to GlobalSwarmState ─────────────
    draft_content: str  # working draft before final write
