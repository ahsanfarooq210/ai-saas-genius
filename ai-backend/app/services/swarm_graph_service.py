import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.agent.graph_mermaid import (
    UnknownSwarmGraphError,
    list_swarm_graphs,
    render_swarm_graph_mermaid,
)
from app.agent.run import build_checkpoint_payload, swarm_config
from app.agent.state.schema import GlobalSwarmState
from app.agent.streaming import normalize_stream_chunk
from app.core.langfuse import swarm_config_with_tracing, swarm_trace
from app.models.swarm import (
    SwarmDebateLog,
    SwarmRevision,
    SwarmSession,
    SwarmSessionArtifact,
)

logger = logging.getLogger(__name__)


class UnknownSwarmSessionError(ValueError):
    pass


class SwarmSessionBusyError(RuntimeError):
    pass


def _empty_swarm_state(task_requirement: str, thread_id: str) -> GlobalSwarmState:
    return {
        "task_requirement": task_requirement,
        "revision_number": 1,
        "revision_instruction": "",
        "revision_pending": False,
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
        user_id: int | None = None,
    ) -> dict[str, Any]:
        with swarm_trace(
            "swarm.run",
            thread_id,
            task_requirement=task_requirement,
        ) as trace:
            if db is not None:
                await run_in_threadpool(
                    self._mark_session_running,
                    db,
                    thread_id,
                    task_requirement,
                    user_id,
                )
            try:
                result = await self._graph.ainvoke(
                    _empty_swarm_state(task_requirement, thread_id),
                    config=swarm_config_with_tracing(
                        swarm_config(thread_id),
                        thread_id,
                        "swarm.run",
                    ),
                )
            except Exception as exc:
                trace.set_error(exc)
                if db is not None:
                    await run_in_threadpool(self._mark_session_failed, db, thread_id)
                raise
            if db is not None:
                await run_in_threadpool(self._mark_session_done, db, thread_id, result)
            trace.set_result(result)
            return result

    async def resume(
        self,
        thread_id: str,
        *,
        db: Session | None = None,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        if db is not None:
            await run_in_threadpool(self._get_owned_session, db, thread_id, user_id)
        with swarm_trace("swarm.resume", thread_id) as trace:
            try:
                result = await self._graph.ainvoke(
                    None,
                    config=swarm_config_with_tracing(
                        swarm_config(thread_id),
                        thread_id,
                        "swarm.resume",
                    ),
                )
            except Exception as exc:
                trace.set_error(exc)
                if db is not None:
                    await run_in_threadpool(self._mark_session_failed, db, thread_id)
                raise
            if db is not None:
                await run_in_threadpool(self._mark_session_done, db, thread_id, result)
            trace.set_result(result)
            return result

    async def revise(
        self,
        instruction: str,
        thread_id: str,
        *,
        db: Session,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        revision_input, revision_number = await run_in_threadpool(
            self._start_revision,
            db,
            thread_id,
            instruction,
            user_id,
        )
        with swarm_trace(
            "swarm.revise",
            thread_id,
            task_requirement=instruction,
        ) as trace:
            try:
                result = await self._graph.ainvoke(
                    revision_input,
                    config=swarm_config_with_tracing(
                        swarm_config(thread_id),
                        thread_id,
                        "swarm.revise",
                    ),
                )
                result.setdefault("revision_number", revision_number)
                result.setdefault("revision_instruction", instruction)
            except Exception as exc:
                trace.set_error(exc)
                await run_in_threadpool(
                    self._mark_revision_failed,
                    db,
                    thread_id,
                    revision_number,
                )
                raise
            await run_in_threadpool(self._mark_session_done, db, thread_id, result)
            trace.set_result(result)
            return result

    async def stream_run(
        self,
        task_requirement: str,
        thread_id: str,
        *,
        db: Session | None = None,
        user_id: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        if db is not None:
            await run_in_threadpool(
                self._mark_session_running,
                db,
                thread_id,
                task_requirement,
                user_id,
            )
        async for event in self._stream_graph(
            _empty_swarm_state(task_requirement, thread_id),
            thread_id,
            operation="swarm.run.stream",
            task_requirement=task_requirement,
            db=db,
        ):
            yield event

    async def stream_resume(
        self,
        thread_id: str,
        *,
        db: Session | None = None,
        user_id: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        if db is not None:
            await run_in_threadpool(self._get_owned_session, db, thread_id, user_id)
            await run_in_threadpool(
                self._mark_session_resume_running,
                db,
                thread_id,
            )
        async for event in self._stream_graph(
            None,
            thread_id,
            operation="swarm.resume.stream",
            db=db,
        ):
            yield event

    async def stream_revise(
        self,
        instruction: str,
        thread_id: str,
        *,
        db: Session,
        user_id: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        revision_input, revision_number = await run_in_threadpool(
            self._start_revision,
            db,
            thread_id,
            instruction,
            user_id,
        )
        return self._stream_graph(
            revision_input,
            thread_id,
            operation="swarm.revise.stream",
            task_requirement=instruction,
            db=db,
            revision_number=revision_number,
        )

    async def get_checkpoint(
        self,
        thread_id: str,
        *,
        db: Session | None = None,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        if db is not None:
            await run_in_threadpool(self._get_owned_session, db, thread_id, user_id)
        snapshot = await self._graph.aget_state(swarm_config(thread_id))
        return build_checkpoint_payload(thread_id, snapshot)

    def get_session(
        self,
        thread_id: str,
        db: Session,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        session = self._get_owned_session(db, thread_id, user_id)

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
        current_revision = (
            db.query(SwarmRevision)
            .filter(
                SwarmRevision.thread_id == thread_id,
                SwarmRevision.revision_number == session.current_revision,
            )
            .one_or_none()
        )
        return {
            "thread_id": session.thread_id,
            "requirement": session.requirement,
            "revision_number": session.current_revision,
            "latest_instruction": (
                current_revision.instruction
                if current_revision is not None
                else (session.requirement if session.current_revision else "")
            ),
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

    @staticmethod
    def list_sessions(
        db: Session,
        user_id: int,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        sessions = (
            db.query(SwarmSession)
            .filter(SwarmSession.user_id == user_id)
            .order_by(SwarmSession.created_at.desc(), SwarmSession.thread_id)
            .offset(offset)
            .limit(limit)
            .all()
        )
        return {
            "sessions": [
                {
                    "thread_id": session.thread_id,
                    "requirement": session.requirement,
                    "revision_number": session.current_revision,
                    "status": session.status,
                    "complexity": session.complexity,
                    "diagram_count": session.diagram_count,
                    "doc_count": session.doc_count,
                    "created_at": (
                        session.created_at.isoformat() if session.created_at else None
                    ),
                    "completed_at": (
                        session.completed_at.isoformat()
                        if session.completed_at
                        else None
                    ),
                }
                for session in sessions
            ]
        }

    @classmethod
    def ensure_session_access(
        cls,
        db: Session,
        thread_id: str,
        user_id: int,
        *,
        allow_missing: bool = False,
    ) -> None:
        session = db.get(SwarmSession, thread_id)
        if session is None and allow_missing:
            return
        if session is None or session.user_id != user_id:
            raise UnknownSwarmSessionError(thread_id)

    def list_revisions(
        self, thread_id: str, db: Session, user_id: int | None = None
    ) -> dict[str, Any]:
        session = self._get_owned_session(db, thread_id, user_id)
        self._ensure_baseline_revision(db, session)
        db.commit()
        revisions = (
            db.query(SwarmRevision)
            .filter(SwarmRevision.thread_id == thread_id)
            .order_by(SwarmRevision.revision_number)
            .all()
        )
        return {
            "thread_id": thread_id,
            "current_revision": session.current_revision,
            "revisions": [self._revision_summary(item) for item in revisions],
        }

    def get_revision(
        self,
        thread_id: str,
        revision_number: int,
        db: Session,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        session = self._get_owned_session(db, thread_id, user_id)
        self._ensure_baseline_revision(db, session)
        db.commit()
        revision = (
            db.query(SwarmRevision)
            .filter(
                SwarmRevision.thread_id == thread_id,
                SwarmRevision.revision_number == revision_number,
            )
            .one_or_none()
        )
        if revision is None:
            raise UnknownSwarmSessionError(
                f"Unknown revision {revision_number} for thread {thread_id}"
            )
        return {
            **self._revision_summary(revision),
            "thread_id": thread_id,
            "result": revision.result_state or {},
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
        operation: str,
        task_requirement: str | None = None,
        db: Session | None = None,
        revision_number: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        with swarm_trace(
            operation,
            thread_id,
            task_requirement=task_requirement,
        ) as trace:
            config = swarm_config_with_tracing(
                swarm_config(thread_id),
                thread_id,
                operation,
            )
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
                    result = dict(snapshot.values or {})
                    if revision_number is not None:
                        result.setdefault("revision_number", revision_number)
                        result.setdefault(
                            "revision_instruction",
                            task_requirement or "",
                        )
                    await run_in_threadpool(
                        self._mark_session_done,
                        db,
                        thread_id,
                        result,
                    )
                    trace.set_result(result)
                else:
                    trace.set_done()
                yield {
                    "event": "done",
                    "data": {"thread_id": thread_id, "status": "done"},
                }
            except asyncio.CancelledError:
                trace.set_cancelled()
                if db is not None:
                    if revision_number is None:
                        await run_in_threadpool(self._mark_session_failed, db, thread_id)
                    else:
                        await run_in_threadpool(
                            self._mark_revision_failed,
                            db,
                            thread_id,
                            revision_number,
                        )
                raise
            except Exception as exc:
                trace.set_error(exc)
                if db is not None:
                    if revision_number is None:
                        await run_in_threadpool(self._mark_session_failed, db, thread_id)
                    else:
                        await run_in_threadpool(
                            self._mark_revision_failed,
                            db,
                            thread_id,
                            revision_number,
                        )
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
    def _revision_summary(revision: SwarmRevision) -> dict[str, Any]:
        return {
            "revision_number": revision.revision_number,
            "instruction": revision.instruction,
            "status": revision.status,
            "created_at": (
                revision.created_at.isoformat() if revision.created_at else None
            ),
            "completed_at": (
                revision.completed_at.isoformat() if revision.completed_at else None
            ),
        }

    @staticmethod
    def _state_from_session(db: Session, session: SwarmSession) -> dict[str, Any]:
        artifacts = (
            db.query(SwarmSessionArtifact)
            .filter(SwarmSessionArtifact.thread_id == session.thread_id)
            .order_by(SwarmSessionArtifact.id)
            .all()
        )
        logs = (
            db.query(SwarmDebateLog)
            .filter(SwarmDebateLog.thread_id == session.thread_id)
            .order_by(SwarmDebateLog.iteration, SwarmDebateLog.id)
            .all()
        )
        diagrams = [
            {
                "diagram_type": item.name,
                "component_slug": item.component_slug,
                "storage_key": item.storage_key,
                "url": item.url,
                "iteration": int(item.iteration or 0),
            }
            for item in artifacts
            if item.artifact_type == "diagram"
        ]
        docs = [
            {
                "title": item.name,
                "component_slug": item.component_slug,
                "storage_key": item.storage_key,
                "url": item.url,
            }
            for item in artifacts
            if item.artifact_type == "doc"
        ]
        return {
            "task_requirement": session.requirement,
            "revision_number": int(session.current_revision or 1),
            "revision_instruction": "",
            "revision_pending": False,
            "architecture_draft": session.architecture_draft or "",
            "architecture_json": session.architecture_json or {},
            "component_list": session.component_list or [],
            "current_architecture_mermaid": (
                session.current_architecture_mermaid or ""
            ),
            "complexity_score": int(session.complexity or 0),
            "diagram_plan": session.diagram_plan or [],
            "doc_plan": session.doc_plan or [],
            "deep_dive_notes": session.deep_dive_notes or "",
            "generated_diagrams": diagrams,
            "thread_id": session.thread_id,
            "generated_docs": docs,
            "docs_complete": bool(session.docs_complete),
            "iteration_count": int(session.iteration_count or 0),
            "next_agent": session.next_agent or "",
            "scalability_feedback": session.scalability_feedback or "",
            "security_feedback": session.security_feedback or "",
            "debate_logs": [
                {
                    "agent": item.agent,
                    "feedback": item.feedback,
                    "status": item.status,
                    "iteration": item.iteration,
                }
                for item in logs
            ],
        }

    @classmethod
    def _ensure_baseline_revision(
        cls,
        db: Session,
        session: SwarmSession,
    ) -> None:
        if session.current_revision <= 0:
            return
        existing = (
            db.query(SwarmRevision.id)
            .filter(
                SwarmRevision.thread_id == session.thread_id,
                SwarmRevision.revision_number == session.current_revision,
            )
            .first()
        )
        if existing is not None:
            return
        completed_at = session.completed_at or datetime.now(timezone.utc)
        db.add(
            SwarmRevision(
                thread_id=session.thread_id,
                revision_number=session.current_revision,
                instruction=session.requirement,
                status="done",
                result_state=cls._state_from_session(db, session),
                created_at=session.created_at,
                completed_at=completed_at,
            )
        )
        db.flush()

    @classmethod
    def _start_revision(
        cls,
        db: Session,
        thread_id: str,
        instruction: str,
        user_id: int | None = None,
    ) -> tuple[GlobalSwarmState, int]:
        if user_id is None:
            raise ValueError("user_id is required for persisted swarm revisions")
        session = (
            db.query(SwarmSession)
            .filter(SwarmSession.thread_id == thread_id)
            .with_for_update()
            .one_or_none()
        )
        if session is None or session.current_revision <= 0:
            raise UnknownSwarmSessionError(thread_id)
        if user_id is not None and session.user_id != user_id:
            raise UnknownSwarmSessionError(thread_id)
        if session.status == "running":
            raise SwarmSessionBusyError(thread_id)

        cls._ensure_baseline_revision(db, session)
        previous_state = cls._state_from_session(db, session)
        latest_number = (
            db.query(func.max(SwarmRevision.revision_number))
            .filter(SwarmRevision.thread_id == thread_id)
            .scalar()
            or session.current_revision
        )
        revision_number = int(latest_number) + 1
        db.add(
            SwarmRevision(
                thread_id=thread_id,
                revision_number=revision_number,
                instruction=instruction,
                status="running",
            )
        )
        session.status = "running"
        session.completed_at = None
        db.commit()

        revision_input = {
            **previous_state,
            "revision_number": revision_number,
            "revision_instruction": instruction,
            "revision_pending": True,
            "docs_complete": False,
            "iteration_count": 0,
            "next_agent": "",
            "scalability_feedback": "",
            "security_feedback": "",
            "debate_logs": [],
        }
        return revision_input, revision_number  # type: ignore[return-value]

    @staticmethod
    def _mark_session_running(
        db: Session,
        thread_id: str,
        task_requirement: str,
        user_id: int | None = None,
    ) -> None:
        if user_id is None:
            raise ValueError("user_id is required for persisted swarm sessions")
        session = db.get(SwarmSession, thread_id)
        if session is None:
            session = SwarmSession(
                thread_id=thread_id,
                user_id=user_id,
                requirement=task_requirement,
                status="running",
            )
            db.add(session)
        else:
            if user_id is not None and session.user_id != user_id:
                raise UnknownSwarmSessionError(thread_id)
            session.requirement = task_requirement
            session.status = "running"
            session.completed_at = None
        db.commit()

    @staticmethod
    def _get_owned_session(
        db: Session,
        thread_id: str,
        user_id: int | None,
    ) -> SwarmSession:
        if user_id is None:
            raise ValueError("user_id is required for persisted swarm sessions")
        query = db.query(SwarmSession).filter(SwarmSession.thread_id == thread_id)
        query = query.filter(SwarmSession.user_id == user_id)
        session = query.one_or_none()
        if session is None:
            raise UnknownSwarmSessionError(thread_id)
        return session

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
    def _mark_revision_failed(
        db: Session,
        thread_id: str,
        revision_number: int,
    ) -> None:
        revision = (
            db.query(SwarmRevision)
            .filter(
                SwarmRevision.thread_id == thread_id,
                SwarmRevision.revision_number == revision_number,
            )
            .one_or_none()
        )
        if revision is not None:
            revision.status = "failed"
            revision.completed_at = datetime.now(timezone.utc)
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
        revision_number = int(
            result.get("revision_number") or session.current_revision or 1
        )
        session.current_revision = revision_number

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
        revision = (
            db.query(SwarmRevision)
            .filter(
                SwarmRevision.thread_id == thread_id,
                SwarmRevision.revision_number == revision_number,
            )
            .one_or_none()
        )
        if revision is None:
            revision = SwarmRevision(
                thread_id=thread_id,
                revision_number=revision_number,
                instruction=(
                    result.get("revision_instruction") or session.requirement
                ),
                status="done",
            )
            db.add(revision)
        revision.status = "done"
        revision.result_state = dict(result)
        revision.completed_at = datetime.now(timezone.utc)
        db.commit()
