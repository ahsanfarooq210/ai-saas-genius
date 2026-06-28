"""add session graph state

Revision ID: 003_add_session_graph_state
Revises: 002_add_session_artifacts
Create Date: 2026-06-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "003_add_session_graph_state"
down_revision = "002_add_session_artifacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("architecture_draft", sa.Text(), nullable=True))
    op.add_column("sessions", sa.Column("architecture_json", sa.JSON(), nullable=True))
    op.add_column("sessions", sa.Column("component_list", sa.JSON(), nullable=True))
    op.add_column(
        "sessions",
        sa.Column("current_architecture_mermaid", sa.Text(), nullable=True),
    )
    op.add_column("sessions", sa.Column("diagram_plan", sa.JSON(), nullable=True))
    op.add_column("sessions", sa.Column("doc_plan", sa.JSON(), nullable=True))
    op.add_column("sessions", sa.Column("deep_dive_notes", sa.Text(), nullable=True))
    op.add_column("sessions", sa.Column("docs_complete", sa.Boolean(), nullable=True))
    op.add_column("sessions", sa.Column("iteration_count", sa.Integer(), nullable=True))
    op.add_column("sessions", sa.Column("next_agent", sa.Text(), nullable=True))
    op.add_column("sessions", sa.Column("scalability_feedback", sa.Text(), nullable=True))
    op.add_column("sessions", sa.Column("security_feedback", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "security_feedback")
    op.drop_column("sessions", "scalability_feedback")
    op.drop_column("sessions", "next_agent")
    op.drop_column("sessions", "iteration_count")
    op.drop_column("sessions", "docs_complete")
    op.drop_column("sessions", "deep_dive_notes")
    op.drop_column("sessions", "doc_plan")
    op.drop_column("sessions", "diagram_plan")
    op.drop_column("sessions", "current_architecture_mermaid")
    op.drop_column("sessions", "component_list")
    op.drop_column("sessions", "architecture_json")
    op.drop_column("sessions", "architecture_draft")
