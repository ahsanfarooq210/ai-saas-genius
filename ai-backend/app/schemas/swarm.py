from pydantic import BaseModel, Field


class SwarmRunRequest(BaseModel):
    task_requirement: str = Field(..., min_length=1)


class SwarmRunResponse(BaseModel):
    task_requirement: str
    architecture_draft: str
