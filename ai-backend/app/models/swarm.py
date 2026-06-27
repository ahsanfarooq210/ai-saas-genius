from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SwarmSession(Base):
    __tablename__ = "sessions"

    thread_id: Mapped[str] = mapped_column(Text, primary_key=True)
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
