# Change: Session graph-state persistence

**Date:** 2026-06-28

## Goal

Make `GET /api/v1/swarm/sessions/{thread_id}` return the same important final graph fields that `POST /api/v1/swarm/run` returns, without requiring the client to rerun the graph.

The root cause was that `/run` returned the in-memory final graph result, while `/sessions/{thread_id}` rebuilt its response only from app database rows. The `sessions` row previously stored status, counts, complexity, timestamps, and artifact/debate rows, but not the final architecture/planning/reviewer fields.

## What changed

### 1. Session model

File: `app/models/swarm.py`

`SwarmSession` now stores a final graph-state projection:

- `architecture_draft`
- `architecture_json`
- `component_list`
- `current_architecture_mermaid`
- `diagram_plan`
- `doc_plan`
- `deep_dive_notes`
- `docs_complete`
- `iteration_count`
- `next_agent`
- `scalability_feedback`
- `security_feedback`

### 2. Database migration

File: `alembic/versions/003_add_session_graph_state.py`

The migration adds the new nullable columns to `sessions`. Existing rows can still be read; missing graph fields default to empty values in the response until the thread is run or resumed again.

### 3. Service persistence and reads

File: `app/services/swarm_graph_service.py`

`_mark_session_done(...)` now persists the final graph-state projection whenever a blocking run, blocking resume, streaming run, or streaming resume completes successfully.

`get_session(...)` now returns:

- session metadata
- persisted graph-state fields
- final artifact rows
- mirrored debate logs

### 4. Public response schema

File: `app/schemas/swarm.py`

`SwarmSessionResponse` now documents the persisted final graph-state fields and `debate_logs`.

## Client contract

Use the run endpoints to execute the graph:

```text
POST /api/v1/swarm/run
POST /api/v1/swarm/run/stream
```

Use the session endpoint to fetch the durable app-table result:

```text
GET /api/v1/swarm/sessions/{thread_id}
```

The session endpoint does not invoke the graph. It returns the last finalized result persisted for that `thread_id`.

## Tests

Covered by:

```bash
pytest tests/test_swarm_graph_service_phase11.py \
       tests/test_swarm_graph_service_streaming.py \
       tests/test_alembic_phase11.py -q
```

Key cases:

- completed runs persist graph-state fields to `sessions`
- session reads return persisted graph-state fields, artifacts, and debate logs
- artifact replacement still works when a thread is finalized again
- Alembic revision `003_add_session_graph_state` chains after `002_add_session_artifacts`
