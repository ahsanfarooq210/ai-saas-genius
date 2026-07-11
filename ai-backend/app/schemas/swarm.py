from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SwarmRunRequest(BaseModel):
    task_requirement: str = Field(..., min_length=1)
    thread_id: str = Field(..., min_length=1, description="Checkpoint thread; same id resumes same lineage")


class SwarmResumeRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)


class SwarmReviseRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)


class SwarmGraphInfo(BaseModel):
    graph_id: str
    name: str
    description: str
    supports_xray: bool = Field(
        description="When true, GET mermaid accepts xray=true to expand nested sub-graphs",
    )


class SwarmGraphListResponse(BaseModel):
    graphs: list[SwarmGraphInfo] = Field(default_factory=list)


class SwarmGraphMermaidResponse(BaseModel):
    graph_id: str
    mermaid: str = Field(description="Mermaid flowchart syntax for the LangGraph topology")
    xray: bool = Field(
        default=False,
        description="Whether nested sub-graphs were expanded (supervisor graph only)",
    )


class DiagramCheckpointItem(BaseModel):
    diagram_type: str
    component_slug: str = ""
    valid: bool = Field(
        description="False when the worker failed to persist a valid diagram artifact",
    )
    storage_key: str = ""
    url: str = ""
    iteration: int = 0


class DocCheckpointItem(BaseModel):
    title: str
    component_slug: str = ""
    storage_key: str = ""
    url: str = ""


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
    revision_number: int = 1
    latest_instruction: str = ""
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


class DiagramEntryResponse(BaseModel):
    diagram_type: str
    component_slug: str = ""
    storage_key: str = ""
    url: str = ""
    iteration: int = 1


class DocEntryResponse(BaseModel):
    title: str
    component_slug: str = ""
    storage_key: str = ""
    url: str = ""


class SessionArtifactResponse(BaseModel):
    artifact_type: str
    name: str
    component_slug: str = ""
    storage_key: str
    url: str
    iteration: int | None = None


class SwarmSessionResponse(BaseModel):
    thread_id: str
    requirement: str
    revision_number: int = 0
    latest_instruction: str = ""
    status: str
    complexity: int | None = None
    diagram_count: int | None = None
    doc_count: int | None = None
    architecture_draft: str = ""
    architecture_json: dict[str, Any] = Field(default_factory=dict)
    component_list: list[str] = Field(default_factory=list)
    current_architecture_mermaid: str = ""
    diagram_plan: list[str] = Field(default_factory=list)
    doc_plan: list[str] = Field(default_factory=list)
    deep_dive_notes: str = ""
    docs_complete: bool = False
    iteration_count: int = 0
    next_agent: str = ""
    scalability_feedback: str = ""
    security_feedback: str = ""
    debate_logs: list[DebateLogEntryResponse] = Field(default_factory=list)
    created_at: str | None = None
    completed_at: str | None = None
    generated_diagrams: list[SessionArtifactResponse] = Field(default_factory=list)
    generated_docs: list[SessionArtifactResponse] = Field(default_factory=list)


class SwarmRevisionSummary(BaseModel):
    revision_number: int
    instruction: str
    status: Literal["running", "done", "failed"]
    created_at: str | None = None
    completed_at: str | None = None


class SwarmRevisionListResponse(BaseModel):
    thread_id: str
    current_revision: int
    revisions: list[SwarmRevisionSummary] = Field(default_factory=list)


class SwarmRevisionResponse(SwarmRevisionSummary):
    thread_id: str
    result: dict[str, Any] = Field(default_factory=dict)


class SwarmStreamProgressEvent(BaseModel):
    thread_id: str
    type: Literal["task_started", "task_completed", "state_update"]
    node: str
    phase: Literal[
        "supervisor",
        "architecture",
        "diagram",
        "documentation",
        "review",
        "unknown",
    ]
    message: str
    iteration_count: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class SwarmStreamDoneEvent(BaseModel):
    thread_id: str
    status: Literal["done"] = "done"


class SwarmStreamErrorEvent(BaseModel):
    thread_id: str
    status: Literal["failed"] = "failed"
    message: str


class SwarmRunResponse(BaseModel):
    """Mirrors ``GlobalSwarmState`` after a full graph run so nothing is stripped at the API layer."""

    model_config = ConfigDict(extra="ignore")

    task_requirement: str
    revision_number: int = 1
    latest_instruction: str = Field(
        default="",
        validation_alias=AliasChoices("latest_instruction", "revision_instruction"),
    )
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
