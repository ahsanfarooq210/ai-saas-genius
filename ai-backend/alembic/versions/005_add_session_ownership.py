"""associate swarm sessions with users

Revision ID: 005_add_session_ownership
Revises: 004_add_swarm_revisions
Create Date: 2026-07-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "005_add_session_ownership"
down_revision = "004_add_swarm_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing sessions predate ownership and remain unassigned. They are not
    # exposed by the user-scoped API; all newly created sessions have an owner.
    op.add_column("sessions", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_sessions_user_id_users",
        "sessions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_sessions_user_id_created_at",
        "sessions",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id_created_at", table_name="sessions")
    op.drop_constraint("fk_sessions_user_id_users", "sessions", type_="foreignkey")
    op.drop_column("sessions", "user_id")
