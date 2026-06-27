"""add session artifacts

Revision ID: 002_add_session_artifacts
Revises: 001_initial_swarm_persistence
Create Date: 2026-06-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "002_add_session_artifacts"
down_revision = "001_initial_swarm_persistence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_artifacts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("artifact_type", sa.String(length=20), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column(
            "component_slug",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["sessions.thread_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_session_artifacts_thread_id"),
        "session_artifacts",
        ["thread_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_session_artifacts_thread_id"),
        table_name="session_artifacts",
    )
    op.drop_table("session_artifacts")
