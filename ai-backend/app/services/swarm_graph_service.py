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
from app.models.swarm import SwarmDebateLog, SwarmSession


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

    async def get_checkpoint(self, thread_id: str) -> dict[str, Any]:
        snapshot = await self._graph.aget_state(swarm_config(thread_id))
        return build_checkpoint_payload(thread_id, snapshot)

    def list_graphs(self) -> list[dict[str, str | bool]]:
        return list_swarm_graphs()

    def get_graph_mermaid(self, graph_id: str, *, xray: bool = False) -> dict[str, Any]:
        try:
            mermaid = render_swarm_graph_mermaid(graph_id, xray=xray)
        except UnknownSwarmGraphError as exc:
            raise ValueError(str(exc)) from exc
        return {"graph_id": graph_id, "mermaid": mermaid, "xray": xray}

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

        db.query(SwarmDebateLog).filter(
            SwarmDebateLog.thread_id == thread_id,
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
        db.commit()
