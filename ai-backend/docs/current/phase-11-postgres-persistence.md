# Phase 11 - Postgres persistence implementation

This document describes the live Phase 11 persistence implementation. It explains what changed, where the code lives, and why the implementation is split between LangGraph-managed checkpoint tables and app-managed SQLAlchemy tables.

If this document disagrees with code, trust the code.

---

## What Phase 11 changed

Before Phase 11, the parent swarm graph used LangGraph's in-memory checkpointer. That was useful for learning and local single-process experiments, but it could not survive a process restart. Phase 11 moves graph checkpoints into Postgres and adds public app tables for run-level progress.

There are now two persistence layers:

| Layer | Purpose | Owner | Tables |
|-------|---------|-------|--------|
| LangGraph checkpoints | Thread state, graph execution snapshots, resume state | LangGraph | Internal tables created by `AsyncPostgresSaver.setup()` |
| App metadata | User-facing run progress and reviewer log summaries | SQLAlchemy + Alembic | `sessions`, `debate_logs` |

The important design rule is that Alembic must manage only the app tables. LangGraph owns its own checkpoint tables.

---

## Files changed

| File | Role |
|------|------|
| `app/db/checkpointer.py` | Opens and initializes the LangGraph Postgres checkpointer |
| `app/agent/graphs/supervisor_graph.py` | Compiles the runtime supervisor graph with an injected checkpointer |
| `app/main.py` | Opens the checkpointer during FastAPI lifespan and registers `SwarmGraphService` |
| `app/services/swarm_graph_service.py` | Runs/resumes the async graph and writes app metadata rows |
| `app/api/v1/endpoints/swarm.py` | Awaits async service methods and passes the SQLAlchemy DB session |
| `app/models/swarm.py` | Defines `SwarmSession` and `SwarmDebateLog` ORM models |
| `app/db/base.py` | Imports swarm models for Alembic discovery |
| `app/db/alembic_filters.py` | Excludes LangGraph schema objects from Alembic autogenerate |
| `alembic/env.py` | Runtime Alembic environment using app metadata and filters |
| `alembic/versions/001_initial_swarm_persistence.py` | Creates `sessions` and `debate_logs` |

Tests live in:

| Test file | Covers |
|-----------|--------|
| `tests/test_checkpointer_phase11.py` | URI normalization and SQLite rejection |
| `tests/test_swarm_graph_service_phase11.py` | Async graph invocation and app table writes |
| `tests/test_alembic_phase11.py` | Model registration and LangGraph schema filtering |

---

## Checkpointer lifecycle

The runtime entry point is `postgres_checkpointer()` in `app/db/checkpointer.py`.

```python
async with AsyncPostgresSaver.from_conn_string(uri) as checkpointer:
    await checkpointer.setup()
    yield checkpointer
```

The logic is:

1. Read `settings.langgraph_postgres_uri()`.
2. Reject SQLite by raising:
   `Phase 11 requires a Postgres DATABASE_URL for LangGraph checkpoints.`
3. Normalize supported Postgres URL forms for psycopg/LangGraph.
4. Open one checkpointer for the FastAPI lifespan.
5. Call `await checkpointer.setup()` on startup.
6. Keep the checkpointer connection alive until app shutdown.

`setup()` is intentionally called every startup. LangGraph treats it as idempotent and uses it to create or migrate its internal checkpoint tables.

### Why startup fails for SQLite

The earlier default `sqlite:///./app.db` is not a production checkpoint store. Phase 11 is explicitly about restart-safe graph checkpoints, so SQLite fallback was removed from the runtime path. Tests can still use fake graphs and in-memory SQLite for unit coverage, but the app itself now expects a Postgres `DATABASE_URL`.

---

## Graph compilation logic

The parent graph no longer hard-codes `MemorySaver`.

`app/agent/graphs/supervisor_graph.py` now has two uses:

| Symbol | Purpose |
|--------|---------|
| `build_supervisor_graph(checkpointer)` | Runtime graph used by FastAPI |
| `supervisor_graph` | Checkpoint-free graph for Mermaid topology rendering and non-runtime tests |

The runtime graph is compiled in `app/main.py`:

```python
async with postgres_checkpointer() as checkpointer:
    graph = build_supervisor_graph(checkpointer)
    app.state.swarm_graph_service = SwarmGraphService(graph)
    yield
```

This keeps graph compilation as a startup concern instead of rebuilding the graph per request. The compiled graph and checkpointer live together for the same app lifespan.

### Why keep a checkpoint-free graph

Graph rendering endpoints call `draw_mermaid()` and do not need checkpoint persistence. Keeping a checkpoint-free module-level graph avoids requiring Postgres just to inspect topology.

---

## API and service flow

The service is now async because the runtime checkpointer is async.

Current request flow:

```text
POST /api/v1/swarm/run
  -> swarm endpoint validates request
  -> FastAPI injects SwarmGraphService and SQLAlchemy Session
  -> SwarmGraphService creates or updates app session row as running
  -> compiled graph.ainvoke(initial_state, config)
  -> SwarmGraphService writes final app metadata and debate logs
  -> endpoint validates SwarmRunResponse
```

Resume flow:

```text
POST /api/v1/swarm/resume
  -> swarm endpoint validates thread_id
  -> SwarmGraphService calls graph.ainvoke(None, config)
  -> LangGraph loads state from Postgres checkpoint tables
  -> service updates app metadata from returned graph state
```

Checkpoint inspection:

```text
GET /api/v1/swarm/state/{thread_id}
  -> SwarmGraphService calls graph.aget_state(config)
  -> build_checkpoint_payload() shapes response fields
```

The HTTP paths did not change:

| Method | Path |
|--------|------|
| `POST` | `/api/v1/swarm/run` |
| `POST` | `/api/v1/swarm/resume` |
| `GET` | `/api/v1/swarm/state/{thread_id}` |
| `GET` | `/api/v1/swarm/graphs` |
| `GET` | `/api/v1/swarm/graphs/{graph_id}/mermaid` |

At the time of the Phase 11 persistence work, streaming and human-feedback routes were out of scope. SSE progress streaming is now implemented; see [streaming.md](streaming.md). Human-feedback interrupts remain out of scope.

---

## App-managed tables

### `sessions`

Model: `SwarmSession` in `app/models/swarm.py`

This table tracks one user-facing swarm run per `thread_id`.

| Column | Meaning |
|--------|---------|
| `thread_id` | Primary key; same value used in LangGraph checkpoint config |
| `requirement` | Original design requirement from `/swarm/run` |
| `status` | `running`, `done`, or `failed` |
| `complexity` | Final `complexity_score` from graph state |
| `diagram_count` | Number of final `generated_diagrams` |
| `doc_count` | Number of final `generated_docs` |
| `architecture_draft` | Final architecture draft text |
| `architecture_json` | Final architecture object returned by the architect |
| `component_list` | Final component names |
| `current_architecture_mermaid` | Final architecture Mermaid summary |
| `diagram_plan` | Final planned diagram entries |
| `doc_plan` | Final planned documentation entries |
| `deep_dive_notes` | Final deep-dive notes when present |
| `docs_complete` | Whether the doc reducer completed |
| `iteration_count` | Final supervisor iteration |
| `next_agent` | Final supervisor route |
| `scalability_feedback` | Final scalability reviewer feedback |
| `security_feedback` | Final security reviewer feedback |
| `created_at` | Server timestamp |
| `completed_at` | Set when graph succeeds or fails |

Run behavior:

| Event | DB write |
|-------|----------|
| `/swarm/run` starts | Insert or update row to `running`; commit before graph execution |
| Graph succeeds | Set `done`, counts, complexity, final graph-state projection, `completed_at` |
| Graph raises | Set `failed`, `completed_at`, then re-raise |
| `/swarm/resume` succeeds | Update existing row from returned graph state |

The service commits the `running` row before awaiting the graph. That matters because the graph can take a long time; if the process dies mid-run after this point, the app table still records a started run.

### `debate_logs`

Model: `SwarmDebateLog` in `app/models/swarm.py`

This table mirrors reviewer debate entries from final graph state.

| Column | Meaning |
|--------|---------|
| `id` | Integer primary key |
| `thread_id` | Foreign key to `sessions.thread_id` |
| `agent` | `scalability` or `security` |
| `feedback` | Full Markdown critique |
| `status` | `APPROVED` or `REJECTED` |
| `iteration` | Supervisor iteration when review ran |
| `created_at` | Server timestamp |

When a run or resume finishes, `SwarmGraphService` replaces existing DB debate logs for that thread with the current `debate_logs` list from graph state. Replacement avoids duplicate rows when the same thread is resumed or rerun.

---

## Alembic and schema ownership

The migration `001_initial_swarm_persistence.py` creates only:

- `sessions`
- `debate_logs`
- index on `debate_logs.thread_id`

LangGraph tables are not listed in the migration. They are created by `AsyncPostgresSaver.setup()`.

`app/db/alembic_filters.py` contains:

```python
def include_object(object_, name, type_, reflected, compare_to) -> bool:
    return getattr(object_, "schema", None) != "langgraph"
```

`alembic/env.py` passes that filter to `context.configure(...)`. This protects future autogenerate runs from trying to manage LangGraph's internal checkpoint schema.

### Operational note about DB URLs

`settings.langgraph_postgres_uri()` normalizes LangGraph checkpoint URLs for psycopg. The app's SQLAlchemy session and Alembic environment still use `settings.DATABASE_URL` directly. For migrations and app table access, prefer a sync SQLAlchemy URL such as:

```text
postgresql+psycopg://user:pass@host/dbname
postgresql+psycopg2://user:pass@host/dbname
```

The Phase 11 implementation does not convert the app/Alembic URL to an async SQLAlchemy migration environment.

---

## Why state and app metadata are separate

LangGraph checkpoints are the source of truth for resumable graph execution. They store graph state snapshots and pending execution metadata. App tables are a user-facing projection of the latest completed result.

This separation keeps responsibilities clean:

| Concern | Stored in |
|---------|-----------|
| Resume exact graph execution | LangGraph checkpoint tables |
| Inspect full graph state via `/state/{thread_id}` | LangGraph checkpoint snapshot shaped by `build_checkpoint_payload()` |
| Read final result fields without invoking the graph | `sessions`, `session_artifacts`, `debate_logs` |
| List run status, counts, requirement, completion time | `sessions` |
| Query reviewer critiques by thread | `debate_logs` |

The service writes app metadata after graph calls instead of writing inside graph nodes. That keeps LangGraph node logic focused on architecture generation and avoids introducing SQLAlchemy dependencies into subagents.

Migration `003_add_session_graph_state.py` adds the graph-state projection columns to `sessions`. Older rows can return defaults for these fields until the thread is run or resumed again.

---

## Testing and verification

Phase 11 tests cover three layers.

```bash
PYTHONPATH=. pytest tests/test_checkpointer_phase11.py \
              tests/test_swarm_graph_service_phase11.py \
              tests/test_alembic_phase11.py -q
```

Expected result after the current implementation:

```text
18 passed
```

Full suite:

```bash
PYTHONPATH=. pytest -q
```

Expected result after the current implementation:

```text
68 passed
```

Manual Postgres acceptance flow:

```bash
export DATABASE_URL="postgresql+psycopg://user:pass@localhost:5432/ai_backend"
PYTHONPATH=. alembic upgrade head
PYTHONPATH=. uvicorn app.main:app --reload
```

Then:

1. Call `POST /api/v1/swarm/run` with a stable `thread_id`.
2. Verify a `sessions` row is created as `running` early in the request.
3. Restart the server.
4. Call `POST /api/v1/swarm/resume` with the same `thread_id`.
5. Verify LangGraph resumes from checkpoint state.
6. Verify `sessions` has final counts and `debate_logs` mirrors reviewer state.

---

## Known boundaries

- The Phase 11 implementation did not add SSE streaming; current streaming behavior is documented in [streaming.md](streaming.md).
- The implementation does not add human feedback interrupts.
- Diagram and doc workers persist artifacts to Cloudinary (`storage_key` + `url` on state entries).
- App metadata is updated at run/resume boundaries, not continuously after every node.
- A process crash after the graph starts but before the response returns can leave the app `sessions.status` as `running`; the LangGraph checkpoint remains the resume source of truth.
