"""Shared Alembic filters for app-managed schemas."""

from __future__ import annotations

from typing import Any


def include_object(
    object_: Any,
    name: str,
    type_: str,
    reflected: bool,
    compare_to: Any,
) -> bool:
    """Keep LangGraph-managed checkpoint tables out of Alembic autogenerate."""
    return getattr(object_, "schema", None) != "langgraph"
