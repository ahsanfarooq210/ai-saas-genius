import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.agent.graph_mermaid import (
    UnknownSwarmGraphError,
    list_swarm_graphs,
    render_swarm_graph_mermaid,
)
from app.agent.run import build_checkpoint_payload, swarm_config
from app.agent.state.schema import GlobalSwarmState
from app.agent.streaming import normalize_stream_chunk
from app.models.swarm import SwarmDebateLog, SwarmSession, SwarmSessionArtifact

logger = logging.getLogger(__name__)


def _empty_swarm_state(task_requirement: str, thread_id: str) -> GlobalSwarmState:
    return {
        "task_requirement": task_requirement,
        "architecture_draft": "",
        "architecture_json": {},
        "component_list": [],
        "current_architecture_mermaid": "",
        "complexity_score": 0,
        "diagram_plan": [],
        "doc_plan": [],
        "deep_dive_notes": "",
        "generated_diagrams": [],
        "thread_id": thread_id,
        "generated_docs": [],
        "docs_complete": False,
        "iteration_count": 0,
        "next_agent": "",
        "scalability_feedback": "",
        "security_feedback": "",
        "debate_logs": [],
    }


class SwarmGraphService:
    """Compiles the swarm graph once; invoke/resume go through the checkpointer."""

    def __init__(self, graph: Any) -> None:
        self._graph = graph

    async def run(
        self,
        task_requirement: str,
        thread_id: str,
        *,
        db: Session | None = None,
    ) -> dict[str, Any]:
        if db is not None:
            self._mark_session_running(db, thread_id, task_requirement)
        try:
            result = await self._graph.ainvoke(
                _empty_swarm_state(task_requirement, thread_id),
                config=swarm_config(thread_id),
            )
        except Exception:
            if db is not None:
                self._mark_session_failed(db, thread_id)
            raise
        if db is not None:
            self._mark_session_done(db, thread_id, result)
        return result

    async def resume(
        self,
        thread_id: str,
        *,
        db: Session | None = None,
    ) -> dict[str, Any]:
        try:
            result = await self._graph.ainvoke(None, config=swarm_config(thread_id))
        except Exception:
            if db is not None:
                self._mark_session_failed(db, thread_id)
            raise
        if db is not None:
            self._mark_session_done(db, thread_id, result)
        return result

    async def stream_run(
        self,
        task_requirement: str,
        thread_id: str,
        *,
        db: Session | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        if db is not None:
            self._mark_session_running(db, thread_id, task_requirement)
        async for event in self._stream_graph(
            _empty_swarm_state(task_requirement, thread_id),
            thread_id,
            db=db,
        ):
            yield event

    async def stream_resume(
        self,
        thread_id: str,
        *,
        db: Session | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        if db is not None:
            self._mark_session_resume_running(db, thread_id)
        async for event in self._stream_graph(None, thread_id, db=db):
            yield event

    async def get_checkpoint(self, thread_id: str) -> dict[str, Any]:
        snapshot = await self._graph.aget_state(swarm_config(thread_id))
        return build_checkpoint_payload(thread_id, snapshot)

    def get_session(self, thread_id: str, db: Session) -> dict[str, Any]:
        session = db.get(SwarmSession, thread_id)
        if session is None:
            raise ValueError(f"Unknown thread_id: {thread_id}")

        artifacts = (
            db.query(SwarmSessionArtifact)
            .filter(SwarmSessionArtifact.thread_id == thread_id)
            .order_by(
                SwarmSessionArtifact.artifact_type,
                SwarmSessionArtifact.iteration,
                SwarmSessionArtifact.id,
            )
            .all()
        )
        diagrams = [
            {
                "artifact_type": artifact.artifact_type,
                "name": artifact.name,
                "component_slug": artifact.component_slug,
                "storage_key": artifact.storage_key,
                "url": artifact.url,
                "iteration": artifact.iteration,
            }
            for artifact in artifacts
            if artifact.artifact_type == "diagram"
        ]
        docs = [
            {
                "artifact_type": artifact.artifact_type,
                "name": artifact.name,
                "component_slug": artifact.component_slug,
                "storage_key": artifact.storage_key,
                "url": artifact.url,
                "iteration": artifact.iteration,
            }
            for artifact in artifacts
            if artifact.artifact_type == "doc"
        ]
        debate_logs = (
            db.query(SwarmDebateLog)
            .filter(SwarmDebateLog.thread_id == thread_id)
            .order_by(SwarmDebateLog.iteration, SwarmDebateLog.id)
            .all()
        )
        return {
            "thread_id": session.thread_id,
            "requirement": session.requirement,
            "status": session.status,
            "complexity": session.complexity,
            "diagram_count": session.diagram_count,
            "doc_count": session.doc_count,
            "architecture_draft": session.architecture_draft or "",
            "architecture_json": session.architecture_json or {},
            "component_list": session.component_list or [],
            "current_architecture_mermaid": session.current_architecture_mermaid or "",
            "diagram_plan": session.diagram_plan or [],
            "doc_plan": session.doc_plan or [],
            "deep_dive_notes": session.deep_dive_notes or "",
            "docs_complete": bool(session.docs_complete),
            "iteration_count": int(session.iteration_count or 0),
            "next_agent": session.next_agent or "",
            "scalability_feedback": session.scalability_feedback or "",
            "security_feedback": session.security_feedback or "",
            "debate_logs": [
                {
                    "agent": log.agent,
                    "feedback": log.feedback,
                    "status": log.status,
                    "iteration": log.iteration,
                }
                for log in debate_logs
            ],
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "completed_at": (
                session.completed_at.isoformat() if session.completed_at else None
            ),
            "generated_diagrams": diagrams,
            "generated_docs": docs,
        }

    def list_graphs(self) -> list[dict[str, str | bool]]:
        return list_swarm_graphs()

    def get_graph_mermaid(self, graph_id: str, *, xray: bool = False) -> dict[str, Any]:
        try:
            mermaid = render_swarm_graph_mermaid(graph_id, xray=xray)
        except UnknownSwarmGraphError as exc:
            raise ValueError(str(exc)) from exc
        return {"graph_id": graph_id, "mermaid": mermaid, "xray": xray}

    async def _stream_graph(
        self,
        graph_input: GlobalSwarmState | None,
        thread_id: str,
        *,
        db: Session | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        config = swarm_config(thread_id)
        try:
            async for chunk in self._graph.astream(
                graph_input,
                config=config,
                stream_mode=["tasks", "updates"],
                subgraphs=True,
                version="v2",
            ):
                for progress in normalize_stream_chunk(thread_id, chunk):
                    yield {"event": "progress", "data": progress}

            if db is not None:
                snapshot = await self._graph.aget_state(config)
                self._mark_session_done(db, thread_id, dict(snapshot.values or {}))
            yield {
                "event": "done",
                "data": {"thread_id": thread_id, "status": "done"},
            }
        except asyncio.CancelledError:
            if db is not None:
                self._mark_session_failed(db, thread_id)
            raise
        except Exception as exc:
            if db is not None:
                self._mark_session_failed(db, thread_id)
            logger.exception("Swarm graph stream failed for thread_id=%s", thread_id)
            yield {
                "event": "error",
                "data": {
                    "thread_id": thread_id,
                    "status": "failed",
                    "message": str(exc),
                },
            }

    @staticmethod
    def _mark_session_running(
        db: Session,
        thread_id: str,
        task_requirement: str,
    ) -> None:
        session = db.get(SwarmSession, thread_id)
        if session is None:
            session = SwarmSession(
                thread_id=thread_id,
                requirement=task_requirement,
                status="running",
            )
            db.add(session)
        else:
            session.requirement = task_requirement
            session.status = "running"
            session.completed_at = None
        db.commit()

    @staticmethod
    def _mark_session_resume_running(db: Session, thread_id: str) -> None:
        session = db.get(SwarmSession, thread_id)
        if session is not None:
            session.status = "running"
            session.completed_at = None
            db.commit()

    @staticmethod
    def _mark_session_failed(db: Session, thread_id: str) -> None:
        session = db.get(SwarmSession, thread_id)
        if session is not None:
            session.status = "failed"
            session.completed_at = datetime.now(timezone.utc)
            db.commit()

    @staticmethod
    def _mark_session_done(
        db: Session,
        thread_id: str,
        result: dict[str, Any],
    ) -> None:
        session = db.get(SwarmSession, thread_id)
        if session is None:
            return

        session.status = "done"
        session.completed_at = datetime.now(timezone.utc)
        session.complexity = int(result.get("complexity_score") or 0)
        session.diagram_count = len(result.get("generated_diagrams") or [])
        session.doc_count = len(result.get("generated_docs") or [])
        session.architecture_draft = result.get("architecture_draft") or ""
        session.architecture_json = result.get("architecture_json") or {}
        session.component_list = result.get("component_list") or []
        session.current_architecture_mermaid = (
            result.get("current_architecture_mermaid") or ""
        )
        session.diagram_plan = result.get("diagram_plan") or []
        session.doc_plan = result.get("doc_plan") or []
        session.deep_dive_notes = result.get("deep_dive_notes") or ""
        session.docs_complete = bool(result.get("docs_complete"))
        session.iteration_count = int(result.get("iteration_count") or 0)
        session.next_agent = result.get("next_agent") or ""
        session.scalability_feedback = result.get("scalability_feedback") or ""
        session.security_feedback = result.get("security_feedback") or ""

        db.query(SwarmDebateLog).filter(
            SwarmDebateLog.thread_id == thread_id,
        ).delete(synchronize_session=False)
        db.query(SwarmSessionArtifact).filter(
            SwarmSessionArtifact.thread_id == thread_id,
        ).delete(synchronize_session=False)
        for entry in result.get("debate_logs") or []:
            db.add(
                SwarmDebateLog(
                    thread_id=thread_id,
                    agent=entry["agent"],
                    feedback=entry["feedback"],
                    status=entry["status"],
                    iteration=int(entry.get("iteration") or 0),
                )
            )
        for entry in result.get("generated_diagrams") or []:
            storage_key = entry.get("storage_key") or ""
            url = entry.get("url") or ""
            if not storage_key or not url:
                continue
            db.add(
                SwarmSessionArtifact(
                    thread_id=thread_id,
                    artifact_type="diagram",
                    storage_key=storage_key,
                    url=url,
                    component_slug=entry.get("component_slug") or "",
                    name=entry["diagram_type"],
                    iteration=int(entry.get("iteration") or 0),
                )
            )
        for entry in result.get("generated_docs") or []:
            storage_key = entry.get("storage_key") or ""
            url = entry.get("url") or ""
            if not storage_key or not url:
                continue
            db.add(
                SwarmSessionArtifact(
                    thread_id=thread_id,
                    artifact_type="doc",
                    storage_key=storage_key,
                    url=url,
                    component_slug=entry.get("component_slug") or "",
                    name=entry["title"],
                    iteration=None,
                )
            )
        db.commit()
