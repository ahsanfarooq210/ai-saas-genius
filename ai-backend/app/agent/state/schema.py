"""TypedDicts — grows phase by phase."""

from typing import TypedDict, Annotated
import operator


class GlobalSwarmState(TypedDict):
    task_requirement: str  # the user's prompt — never mutated after init
    architecture_draft: str  # plain text — placeholder until Phase 2
    architecture_json: (
        dict  # structured component map: {component: {description, relations}}
    )
    component_list: list[str]  # ["API Gateway", "Auth Service", "Cache", "DB"]
    current_architecture_mermaid: str  # overview diagram (Mermaid flowchart)
    complexity_score: int  # 1–10; drives how many diagrams/docs are made
    diagram_plan: list[str]  # ["overview", "component-api-gateway", "auth-flow", ...]
    doc_plan: list[str]  # ["overview.md", "api-gateway.md", "auth-service.md", ...]
    deep_dive_notes: str  # empty until deep_dive_node runs
    generated_diagrams: Annotated[list["DiagramEntry"], operator.add]
    thread_id: str  # checkpoint thread; used for artifact paths
    generated_docs: Annotated[list["DocEntry"], operator.add]
    docs_complete: bool  # set True when doc sub-graph finishes (Phase 9 supervisor gate)
    iteration_count: int  # supervisor increments every lap; hard limit = 5
    next_agent: str  # set by supervisor for visibility; routing uses return value
    scalability_feedback: str  # "" until reviewed; stub sets "STATUS: APPROVED"
    security_feedback: str  # "" until reviewed; stub sets "STATUS: APPROVED"


class ArchitectInternalState(TypedDict):
    draft_mermaid: str  # scratchpad during Mermaid generation
    linter_errors: list[str]  # feedback between linter and generator
    internal_loop_count: int  # lint-fix retry counter; hard limit = 3
    current_diagram_type: str  # which diagram is being worked on right now


class DiagramEntry(TypedDict):
    diagram_type: str  # "overview" | "component-api-gateway" | "auth-flow" | ...
    component_slug: str  # component-scoped slug, or "" for cross-cutting diagrams
    content: str  # raw Mermaid string
    path: str  # file key: diagrams/{thread_id}/iter{n}_{diagram_type}.mmd
    iteration: int  # which swarm pass produced this


class DiagramWorkerState(TypedDict):
    # Each parallel Send() invocation gets its OWN isolated copy of this state.
    # Workers cannot see each other's state — total isolation.
    diagram_type: str  # "overview" | "component-api-gateway" | "auth-flow"
    component_slug: str  # slug this diagram is scoped to, "" for cross-cutting
    task_requirement: str  # passed down from GlobalSwarmState
    architecture_json: dict  # full context so worker generates accurately
    draft_mermaid: str  # scratchpad — worker writes here before linting
    linter_errors: list[str]  # errors from the linter on the last attempt
    internal_loop_count: int  # how many lint-fix attempts so far; hard limit = 3
    thread_id: str  # for building the file path
    iteration: int  # current swarm pass number


class DocEntry(TypedDict):
    title: str
    component_slug: str  # pairs with DiagramEntry; "" for overview / ADR / runbook
    content: str
    path: str  # reports/{thread_id}/{filename}


class DocWorkerState(TypedDict):
    doc_filename: str
    component_slug: str
    task_requirement: str
    architecture_json: dict
    generated_diagrams: list[DiagramEntry]
    thread_id: str
    iteration: int
