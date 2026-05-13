from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SwarmRunRequest(BaseModel):
    task_requirement: str = Field(..., min_length=1)


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
    complexity_score: int = 0
    diagram_plan: list[str] = Field(default_factory=list)
    doc_plan: list[str] = Field(default_factory=list)
