# Checkpointer, external Postgres, and Alembic

This document explains how the LangGraph checkpointer works with an external Postgres database and how that fits with Alembic.

## The two database responsibilities

The backend uses the same Postgres database for two different responsibilities:

| Responsibility | Owner | What it stores |
|----------------|-------|----------------|
| Graph execution checkpoints | LangGraph `AsyncPostgresSaver` | checkpoint snapshots, pending execution metadata, resumable thread state |
| App data | SQLAlchemy models + Alembic | users, swarm sessions, artifacts, debate logs, revision history, final result projection |

These are intentionally separate. LangGraph tables are internal runtime infrastructure. App tables are the public backend data model.

## Startup flow

`app/main.py` wires persistence during the FastAPI lifespan:

```text
FastAPI startup
  -> validate_required_app_tables(engine)
  -> artifact_store.configure_from_settings(settings)
  -> postgres_checkpointer()
       -> require_langgraph_postgres_uri(settings)
       -> AsyncPostgresSaver.from_conn_string(uri)
       -> checkpointer.setup()
  -> build_supervisor_graph(checkpointer)
  -> app.state.swarm_graph_service = SwarmGraphService(graph)
```

If app tables are missing, startup fails with a message telling you to run Alembic first.

## DATABASE_URL normalization

`settings.DATABASE_URL` is the SQLAlchemy URL used by:

- `app/db/session.py`
- Alembic
- app table validation

The LangGraph checkpointer needs a psycopg/libpq-style URI. `settings.langgraph_postgres_uri()` converts common SQLAlchemy driver URLs into that shape.

Examples:

| Input `DATABASE_URL` | LangGraph checkpointer URI |
|----------------------|----------------------------|
| `sqlite:///./app.db` | rejected for Phase 11 runtime |
| `postgresql+psycopg://user:pass@localhost/db` | `postgresql://user:pass@localhost/db` |
| `postgresql+psycopg2://user:pass@localhost/db` | `postgresql://user:pass@localhost/db` |
| `postgres://user:pass@host/db` | `postgresql://user:pass@host/db` |

For remote hosts, the normalized URI gets:

- `sslmode=require` unless already present or overridden
- `keepalives=1`
- `keepalives_idle=30`

Use `LANGGRAPH_POSTGRES_SSLMODE=disable` for local Docker setups that cannot use SSL. Leave it unset for most managed Postgres services.

## What Alembic owns

Alembic owns app-managed tables only.

Current migration chain:

```text
7ff644cccf7c_initial_users
  -> 001_initial_swarm_persistence
  -> 002_add_session_artifacts
  -> 003_add_session_graph_state
  -> 004_add_swarm_revisions
  -> 005_add_session_ownership
```

App tables:

| Table | Created/updated by |
|-------|--------------------|
| `users` | `7ff644cccf7c_initial_users.py` |
| `sessions` | `001_initial_swarm_persistence.py`, `003_add_session_graph_state.py`, `004_add_swarm_revisions.py`, `005_add_session_ownership.py` |
| `debate_logs` | `001_initial_swarm_persistence.py` |
| `session_artifacts` | `002_add_session_artifacts.py` |
| `swarm_revisions` | `004_add_swarm_revisions.py` |

Run migrations before starting the API:

```bash
PYTHONPATH=. alembic upgrade head
```

## What LangGraph owns

LangGraph checkpoint tables are created or updated by:

```python
await checkpointer.setup()
```

That call happens inside `postgres_checkpointer()` during app startup.

Do not create migrations for LangGraph checkpoint tables. They are implementation details of `langgraph-checkpoint-postgres`.

## Alembic filtering

`app/db/alembic_filters.py` excludes objects in the `langgraph` schema:

```python
return getattr(object_, "schema", None) != "langgraph"
```

`alembic/env.py` passes this filter to Alembic. This protects future autogenerate runs from trying to manage LangGraph's internal checkpoint schema.

## Request-time checkpointing

Requests pass a thread config into LangGraph:

```python
{"configurable": {"thread_id": thread_id}}
```

That `thread_id` is the checkpoint lineage. A blocking run starts from an initial state. A revision starts a new execution using the latest successful app projection plus a follow-up instruction. A resume starts from `None`, which tells LangGraph to continue from the checkpoint for that thread.

The checkpointer does not enforce user ownership. Before calling `aget_state`, resume, or revision operations, the service verifies the authenticated user against `sessions.user_id`. Missing and cross-user threads are both exposed as `404`.

Streaming uses the same config with `astream(...)`, then reads the final checkpoint snapshot with `aget_state(...)` before finalizing app tables.

## Operational order

For an external Postgres database:

1. Set `DATABASE_URL` to a Postgres SQLAlchemy URL.
2. Set `LANGGRAPH_POSTGRES_SSLMODE` only if the default SSL behavior is wrong for your database.
3. Run `PYTHONPATH=. alembic upgrade head`.
4. Start the API.
5. Startup validates app tables.
6. Startup lets LangGraph create or verify checkpoint tables.
7. Requests can now run, stream, resume, and read state by `thread_id`.

## Common failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Startup says Phase 11 requires Postgres | `DATABASE_URL` is SQLite | use a Postgres `DATABASE_URL` |
| Startup says app tables are missing | Alembic has not run | run `PYTHONPATH=. alembic upgrade head` |
| SSL disconnects on managed Postgres | missing SSL/keepalive params | leave `LANGGRAPH_POSTGRES_SSLMODE` unset so defaults apply, or set explicit value |
| Alembic wants to manage checkpoint tables | filter/schema config changed | keep LangGraph objects out of Alembic autogenerate |

## Related docs

- [session-data-flow.md](session-data-flow.md)
- [`../graphs/overview.md`](../graphs/overview.md)
- [`../current/phase-11-postgres-persistence.md`](../current/phase-11-postgres-persistence.md)
