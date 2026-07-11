"""add iterative swarm revisions

Revision ID: 004_add_swarm_revisions
Revises: 003_add_session_graph_state
Create Date: 2026-07-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "004_add_swarm_revisions"
down_revision = "003_add_session_graph_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column(
            "current_revision",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.execute(
        "UPDATE sessions SET current_revision = 1 "
        "WHERE status = 'done'"
    )
    op.create_table(
        "swarm_revisions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("result_state", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["sessions.thread_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "thread_id",
            "revision_number",
            name="uq_swarm_revisions_thread_revision",
        ),
    )
    op.create_index(
        op.f("ix_swarm_revisions_thread_id"),
        "swarm_revisions",
        ["thread_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_swarm_revisions_thread_id"),
        table_name="swarm_revisions",
    )
    op.drop_table("swarm_revisions")
    op.drop_column("sessions", "current_revision")
