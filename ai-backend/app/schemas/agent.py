from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CreateThreadRequest(BaseModel):
    """Body for creating a new chat thread with an LLM-generated name."""

    task_requirement: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Natural-language requirement used to seed the thread and generate its name.",
    )
    user_id: Optional[str] = Field(
        default=None,
        max_length=256,
        description="Optional external user id for namespacing.",
    )


class CreateThreadResponse(BaseModel):
    """Returned when a new thread is created."""

    thread_id: str = Field(..., description="UUID for the newly created thread.")
    thread_name: str = Field(..., description="LLM-generated short title for the thread.")


class SwarmRunRequest(BaseModel):
    """Body for running the architecture swarm once end-to-end."""

    task_requirement: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Natural-language system design or product requirement for the swarm.",
    )
    thread_id: Optional[str] = Field(
        default=None,
        max_length=256,
        description="Optional idempotency / session id; generated if omitted.",
    )
    user_id: Optional[str] = Field(
        default=None,
        max_length=256,
        description="Optional external user id for namespacing (e.g. auth subject).",
    )


class AgentGraphMermaidResponse(BaseModel):
    """Mermaid diagram text for the swarm `StateGraph` (paste into https://mermaid.live or render clientside)."""

    mermaid: str = Field(..., description="Mermaid graph definition produced by LangGraph’s graph API.")


class SwarmRunResponse(BaseModel):
    """Final `GlobalSwarmState` after the graph completes (or hits iteration limit)."""

    thread_id: str
    user_id: Optional[str] = None
    task_requirement: str
    iteration_count: int
    docs_complete: bool
    next_agent: str
    current_architecture_mermaid: str
    architecture_json: Dict[str, Any]
    component_list: List[str]
    complexity_score: int
    diagram_plan: List[str]
    doc_plan: List[str]
    generated_diagrams: List[Dict[str, Any]]
    generated_docs: List[Dict[str, Any]]
    scalability_feedback: str
    security_feedback: str

    # Progress metadata (mirrors `GlobalSwarmState` progress section)
    current_stage: str = ""
    current_task: str = ""
    progress_message: str = ""
    active_item_type: str = ""
    active_item_name: str = ""
    completed_diagram_count: int = 0
    completed_doc_count: int = 0
    total_diagram_count: int = 0
    total_doc_count: int = 0
