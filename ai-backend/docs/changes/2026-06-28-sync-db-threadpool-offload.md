# Change: Sync DB persistence threadpool offload

**Date:** 2026-06-28

## Goal

Prevent synchronous SQLAlchemy session reads and writes from blocking the FastAPI event loop during swarm run, resume, streaming, and session-read requests.

The app-table persistence helpers in `app/services/swarm_graph_service.py` are intentionally still synchronous. The issue was that async service methods and an async endpoint called those helpers directly, so each ORM read/write and commit ran on the event-loop thread.

## What changed

### 1. Service persistence calls

File: `app/services/swarm_graph_service.py`

The async service methods now invoke existing sync persistence helpers with `starlette.concurrency.run_in_threadpool(...)`:

- `_mark_session_running(...)`
- `_mark_session_resume_running(...)`
- `_mark_session_failed(...)`
- `_mark_session_done(...)`

The helper bodies were not changed. They still own the same `SwarmSession`, `SwarmDebateLog`, and `SwarmSessionArtifact` writes.

### 2. Session read endpoint

File: `app/api/v1/endpoints/swarm.py`

`GET /api/v1/swarm/sessions/{thread_id}` now calls the synchronous `service.get_session(...)` through `run_in_threadpool(...)` before validating the response schema.

## Why this is narrow

This is not an async SQLAlchemy migration. It does not change:

- `app/db/session.py`
- `get_db`
- ORM models
- Alembic migrations
- public request or response schemas
- graph execution or checkpoint behavior

The only behavioral intent is to avoid event-loop blocking while preserving the existing sync ORM persistence flow.

## Rollback

If this causes a database/session lifecycle issue, revert the threadpool wrapping only:

1. Remove `from starlette.concurrency import run_in_threadpool` from `app/services/swarm_graph_service.py`.
2. Replace each `await run_in_threadpool(self._mark_session_..., ...)` call with the previous direct `self._mark_session_...(db, ...)` call.
3. Remove `from starlette.concurrency import run_in_threadpool` from `app/api/v1/endpoints/swarm.py`.
4. Replace `await run_in_threadpool(service.get_session, thread_id, db)` with `service.get_session(thread_id, db)`.

The synchronous helper implementations can remain as-is because this change did not modify their internals.

## Tests

Run the focused regression suite:

```bash
PYTHONPYCACHEPREFIX=/tmp/codex_pycache ./.venv/bin/python -m pytest -q \
  tests/test_swarm_graph_service_phase11.py \
  tests/test_swarm_graph_service_streaming.py \
  tests/test_swarm_streaming_events.py
```
