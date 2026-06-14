"""initial swarm persistence

Revision ID: 001_initial_swarm_persistence
Revises:
Create Date: 2026-06-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "001_initial_swarm_persistence"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("requirement", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="running",
            nullable=False,
        ),
        sa.Column("complexity", sa.Integer(), nullable=True),
        sa.Column("diagram_count", sa.Integer(), nullable=True),
        sa.Column("doc_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("thread_id"),
    )
    op.create_table(
        "debate_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("agent", sa.String(length=30), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
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
        op.f("ix_debate_logs_thread_id"),
        "debate_logs",
        ["thread_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_debate_logs_thread_id"), table_name="debate_logs")
    op.drop_table("debate_logs")
    op.drop_table("sessions")
