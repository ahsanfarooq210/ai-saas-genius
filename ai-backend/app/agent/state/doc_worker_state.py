# Worker payload for LangGraph Send() map-reduce — shared schema types live in global_swarm_state.
from typing import TypedDict

from app.agent.state.global_swarm_state import DiagramEntry


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
