from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SwarmRunRequest(BaseModel):
    task_requirement: str = Field(..., min_length=1)
    thread_id: str = Field(..., min_length=1, description="Checkpoint thread; same id resumes same lineage")


class SwarmResumeRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)


class DiagramCheckpointItem(BaseModel):
    diagram_type: str
    component_slug: str = ""
    valid: bool = Field(
        description="False when the worker exhausted lint retries (content is syntax_error)",
    )
    path: str = ""
    iteration: int = 0


class DocCheckpointItem(BaseModel):
    title: str
    component_slug: str = ""
    path: str = ""


class DebateLogCheckpointItem(BaseModel):
    agent: str
    status: str
    iteration: int = 0


class DebateLogEntryResponse(BaseModel):
    agent: str
    feedback: str
    status: str
    iteration: int = 0


class SwarmCheckpointResponse(BaseModel):
    thread_id: str
    next: tuple[str, ...] = Field(
        default_factory=tuple,
        description="Next node(s) to run; empty means the graph reached END",
    )
    component_list: list[str] = Field(default_factory=list)
    complexity_score: int = 0
    diagram_plan: list[str] = Field(default_factory=list)
    generated_diagram_count: int = 0
    generated_diagrams: list[DiagramCheckpointItem] = Field(default_factory=list)
    generated_doc_count: int = 0
    generated_docs: list[DocCheckpointItem] = Field(default_factory=list)
    docs_complete: bool = False
    iteration_count: int = 0
    next_agent: str = ""
    scalability_feedback: str = ""
    security_feedback: str = ""
    debate_log_count: int = 0
    debate_logs: list[DebateLogCheckpointItem] = Field(default_factory=list)
    values: dict[str, Any] = Field(
        default_factory=dict,
        description="Full checkpoint values including Mermaid content",
    )


class DiagramEntryResponse(BaseModel):
    diagram_type: str
    component_slug: str = ""
    content: str
    path: str = ""
    iteration: int = 1


class DocEntryResponse(BaseModel):
    title: str
    component_slug: str = ""
    content: str
    path: str = ""


class SwarmRunResponse(BaseModel):
    """Mirrors ``GlobalSwarmState`` after a full graph run so nothing is stripped at the API layer."""

    model_config = ConfigDict(extra="ignore")

    task_requirement: str
    architecture_draft: str
    architecture_json: dict[str, Any] = Field(
        default_factory=dict,
        description="Map of component name to {description, relations}",
    )
    component_list: list[str] = Field(default_factory=list)
    current_architecture_mermaid: str = ""
    complexity_score: int = 0
    diagram_plan: list[str] = Field(default_factory=list)
    doc_plan: list[str] = Field(default_factory=list)
    deep_dive_notes: str = ""
    generated_diagrams: list[DiagramEntryResponse] = Field(default_factory=list)
    thread_id: str = ""
    generated_docs: list[DocEntryResponse] = Field(default_factory=list)
    docs_complete: bool = False
    iteration_count: int = 0
    next_agent: str = ""
    scalability_feedback: str = ""
    security_feedback: str = ""
    debate_logs: list[DebateLogEntryResponse] = Field(default_factory=list)
