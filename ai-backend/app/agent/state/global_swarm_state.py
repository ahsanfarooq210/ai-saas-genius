# graph/schema.py
from typing import TypedDict, Annotated, Optional
import operator


class DiagramEntry(TypedDict):
    diagram_type: str  # "overview" | "auth-flow" | "db-schema" | "infra" | etc.
    content: str  # raw Mermaid string — "syntax_error" if linter failed 3x
    path: str  # file store key e.g. "diagrams/{thread_id}/iter2_overview.mmd"
    iteration: int  # which swarm iteration produced this


class DocEntry(TypedDict):
    title: str  # e.g. "Auth Service — Component Overview"
    content: str  # raw Markdown string
    path: str  # file store key e.g. "reports/{thread_id}/auth-service.md"


class GlobalSwarmState(TypedDict):
    # ── Core input ────────────────────────────────────────────────────────────
    thread_id: str  # session identifier — set once on init, never mutated
    user_id: Optional[str]  # optional — for memory store namespacing
    task_requirement: str  # original user prompt — never mutated after init

    # ── Architecture output ───────────────────────────────────────────────────
    current_architecture_mermaid: (
        str  # primary overview diagram (Mermaid source string)
    )
    architecture_json: dict  # structured component map for programmatic use

    # ── Complexity analysis ───────────────────────────────────────────────────
    component_list: list[str]  # ["API Gateway", "Auth Service", "Redis Cache", ...]
    complexity_score: int  # 1–10 — drives how many diagrams and docs are generated
    diagram_plan: list[str]  # ["overview", "auth-flow", "db-schema", "infra", ...]
    doc_plan: list[str]  # ["overview.md", "auth-service.md", "adr-caching.md", ...]

    # ── Generated artifacts ───────────────────────────────────────────────────
    # Annotated with operator.add — REQUIRED for Map-Reduce Send() fan-out.
    # Without this, parallel diagram/doc workers overwrite each other.
    generated_diagrams: Annotated[list[DiagramEntry], operator.add]
    generated_docs: Annotated[list[DocEntry], operator.add]

    # ── Review feedback ───────────────────────────────────────────────────────
    scalability_feedback: str  # full Markdown critique ending with "STATUS: APPROVED" or "STATUS: REJECTED"
    security_feedback: str  # same format as scalability_feedback

    # ── Control flow ──────────────────────────────────────────────────────────
    iteration_count: int  # incremented by Supervisor only — hard limit 5
    docs_complete: bool  # set True by Doc sub-graph — gates Supervisor routing
    next_agent: str  # routing flag set by Supervisor — never read by workers

    # ── Progress (structured UI / API; not inferred from raw artifacts) ─────
    current_stage: str  # "supervisor" | "architect" | "docs" | "scalability" | "security" | "done"
    current_task: str  # short human-readable label for the active step
    progress_message: str  # longer UI-friendly line
    active_item_type: str  # "diagram" | "doc" | "review" | ""
    active_item_name: str  # e.g. "overview", "auth-flow", "overview.md"
    completed_diagram_count: int
    completed_doc_count: int
    total_diagram_count: int
    total_doc_count: int


def initial_state(
    thread_id: str, requirement: str, user_id: Optional[str] = None
) -> GlobalSwarmState:
    """
    Factory function — always use this to initialize state.
    Never construct GlobalSwarmState manually to avoid missing field errors.
    """
    return GlobalSwarmState(
        thread_id=thread_id,
        user_id=user_id,
        task_requirement=requirement,
        current_architecture_mermaid="",
        architecture_json={},
        component_list=[],
        complexity_score=0,
        diagram_plan=[],
        doc_plan=[],
        generated_diagrams=[],
        generated_docs=[],
        scalability_feedback="",
        security_feedback="",
        iteration_count=0,
        docs_complete=False,
        next_agent="",
        current_stage="supervisor",
        current_task="",
        progress_message="",
        active_item_type="",
        active_item_name="",
        completed_diagram_count=0,
        completed_doc_count=0,
        total_diagram_count=0,
        total_doc_count=0,
    )
