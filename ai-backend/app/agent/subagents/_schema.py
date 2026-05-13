from typing import Any, Self

from pydantic import BaseModel, Field, model_validator


class Component(BaseModel):
    description: str = Field(description="What this component does")
    relations: list[str] = Field(
        description="Names of other components this one depends on or calls"
    )


class ArchitectureComponentItem(BaseModel):
    """One row in the architect LLM output (list serializes reliably in JSON schema)."""

    name: str = Field(description="Short unique component name")
    description: str = Field(description="What this component does")
    relations: list[str] = Field(
        default_factory=list,
        description="Names of other components this one depends on or calls",
    )

    @model_validator(mode="before")
    @classmethod
    def coerce_relations_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if data.get("relations") is None and data.get("dependencies") is not None:
                return {**data, "relations": data["dependencies"]}
        return data


class ArchitectureDraft(BaseModel):
    """
    Structured output for the lead architect.

    Uses a top-level ``components`` list so OpenAI-compatible APIs do not emit
    an ambiguous ``architecture_json.components`` object that fails
    ``dict[str, Component]`` validation.
    """

    components: list[ArchitectureComponentItem] = Field(
        description="System components in order, most important first. Use 3–12 items.",
        min_length=1,
        max_length=16,
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_wrapped_shapes(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if "components" in data:
            return data
        inner = data.get("architecture_json")
        if isinstance(inner, list):
            return {"components": inner}
        if isinstance(inner, dict):
            if "components" in inner:
                return {"components": inner["components"]}
            if inner and all(isinstance(v, dict) for v in inner.values()):
                components = []
                for name, v in inner.items():
                    row = {"name": name, **v} if isinstance(v, dict) else {"name": name}
                    components.append(row)
                return {"components": components}
        return data

    @model_validator(mode="after")
    def validate_names_align(self) -> Self:
        for item in self.components:
            if not item.name.strip():
                raise ValueError("Each component must have a non-empty name")
        return self


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
