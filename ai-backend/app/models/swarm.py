from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Index,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SwarmSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_user_id_created_at", "user_id", "created_at"),
    )

    thread_id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    requirement: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        default="running",
        server_default="running",
        nullable=False,
    )
    complexity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diagram_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doc_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    architecture_draft: Mapped[str | None] = mapped_column(Text, nullable=True)
    architecture_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    component_list: Mapped[list | None] = mapped_column(JSON, nullable=True)
    current_architecture_mermaid: Mapped[str | None] = mapped_column(Text, nullable=True)
    diagram_plan: Mapped[list | None] = mapped_column(JSON, nullable=True)
    doc_plan: Mapped[list | None] = mapped_column(JSON, nullable=True)
    deep_dive_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    docs_complete: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    iteration_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    scalability_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    security_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_revision: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class SwarmDebateLog(Base):
    __tablename__ = "debate_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("sessions.thread_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent: Mapped[str] = mapped_column(String(30), nullable=False)
    feedback: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    iteration: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class SwarmSessionArtifact(Base):
    __tablename__ = "session_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("sessions.thread_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    artifact_type: Mapped[str] = mapped_column(String(20), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    component_slug: Mapped[str] = mapped_column(Text, nullable=False, default="")
    name: Mapped[str] = mapped_column(Text, nullable=False)
    iteration: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class SwarmRevision(Base):
    __tablename__ = "swarm_revisions"
    __table_args__ = (
        UniqueConstraint(
            "thread_id",
            "revision_number",
            name="uq_swarm_revisions_thread_revision",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("sessions.thread_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    result_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
