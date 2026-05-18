from typing import Any

from pydantic import BaseModel, Field, model_validator


class ComponentDetail(BaseModel):
    """Value shape inside architecture_json — name lives in the dict key, not here."""

    description: str = Field(default="", description="What this component does")
    relations: list[str] = Field(
        default_factory=list,
        description="Other component names this one depends on",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_row(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if data.get("relations") is None and data.get("dependencies") is not None:
            return {**data, "relations": data["dependencies"]}
        return data


class ArchitectComponent(BaseModel):
    name: str = Field(min_length=1, description="Short unique component name")
    description: str = Field(default="", description="What this component does")
    relations: list[str] = Field(
        default_factory=list,
        description="Other component names this one depends on",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_row(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if data.get("relations") is None and data.get("dependencies") is not None:
            return {**data, "relations": data["dependencies"]}
        return data


class ArchitectureOutput(BaseModel):
    architecture_json: dict[str, ComponentDetail]
    component_list: list[str]
    current_architecture_mermaid: str = Field(
        description=(
            "A valid Mermaid flowchart showing all components and their relationships. "
            "Use flowchart TD syntax. Every component in component_list must appear as a node. "
            "Example: flowchart TD\\n  API[API Gateway] --> Auth[Auth Service]"
        )
    )


class ArchitectureDraft(BaseModel):
    """LLM returns: {\"components\": [{\"name\", \"description\", \"relations\"}, ...]}."""

    components: list[ArchitectComponent] = Field(
        min_length=1,
        max_length=16,
        description="Ordered most important first",
    )


class ComplexityOutput(BaseModel):
    complexity_score: int = Field(
        ge=1,
        le=10,
        description="Complexity score 1-10. 1-3 simple/monolith, 4-6 microservices, 7-10 distributed",
    )
    diagram_plan: list[str] = Field(
        description=(
            "List of diagram identifiers to generate. "
            "Always include 'overview'. "
            "For each component, include 'component-{slug}' where slug is the "
            "lowercased, hyphenated component name e.g. 'component-api-gateway'. "
            "For score 4+, add cross-cutting diagrams from: "
            "auth-flow, db-schema, infra, data-pipeline, api-contracts, event-flow, deployment."
        )
    )
    doc_plan: list[str] = Field(
        description=(
            "List of markdown filenames to generate. "
            "Always include 'overview.md'. "
            "For each component include '{slug}.md' using the same slugs as diagram_plan. "
            "For score 7+, add 'adr-{title}.md' or 'runbook-{title}.md' as needed."
        )
    )
