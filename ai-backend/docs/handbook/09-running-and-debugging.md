# Running and debugging

## Configuration groups

`app/core/config.py` loads `.env` at import time. Invalid settings can prevent `app.main` from importing, before Uvicorn starts.

| Group | Important settings |
|---|---|
| app/server | `APP_ENV`, `HOST`, `PORT`, `API_V1_PREFIX` |
| database/checkpoint | `DATABASE_URL`, `LANGGRAPH_POSTGRES_SSLMODE` |
| LLM | `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`, `OPENCODE_MODEL`, `OPENCODE_TEMPERATURE` |
| artifacts | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_ARTIFACT_FOLDER` |
| auth | JWT secrets/algorithm/expiries, `COOKIE_SECURE`, `CORS_ALLOWED_ORIGINS` |
| tracing | `LANGFUSE_TRACING_ENABLED` and `LANGFUSE_*` settings |

The runtime requires Postgres because `postgres_checkpointer()` fails fast when the normalized URI is not `postgresql://`. Remote hosts default to `sslmode=require` unless overridden.

## Startup sequence and common failures

| Startup stage | Failure usually means |
|---|---|
| settings import | invalid cookie/CORS policy or malformed environment value |
| app-table validation | Alembic migrations have not reached the required schema |
| artifact-store configuration | one or more Cloudinary credentials are missing |
| checkpointer setup | database is not Postgres, unreachable, has SSL trouble, or lacks permissions |
| graph/service registration | an import, dependency, or graph compile error |

Recommended startup commands:

```bash
PYTHONPATH=. alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

For plain HTTP localhost development, ensure `.env` uses `APP_ENV=development`, `COOKIE_SECURE=false`, and includes the exact frontend origin.

## How to trace a failed run

Follow the deepest failing layer instead of assuming the database is responsible:

```text
HTTP route
  -> SwarmGraphService operation
    -> parent/subgraph node
      -> LLM, Cloudinary, checkpointer, or app-table operation
```

Useful evidence:

- If a `sessions` row exists and becomes `failed`, session creation/update worked; inspect graph/node/provider failure next.
- If startup never reaches Uvicorn, inspect settings and lifespan dependencies first.
- If synchronous `/run` fails but database writes exist, inspect the traceback for a concrete agent node or provider exception.
- If SSE sends `error`, the message came from `_stream_graph`; server logs retain the full exception traceback.
- If `/state` and `/sessions/{id}` differ, remember they intentionally read from different persistence layers.

## Focused tests

Use the repository virtual environment and `PYTHONPATH=.`:

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_supervisor_routing_phase9.py -q
PYTHONPATH=. .venv/bin/pytest tests/test_subgraph_artifact_accumulation.py -q
PYTHONPATH=. .venv/bin/pytest tests/test_swarm_graph_service_streaming.py tests/test_swarm_streaming_events.py -q
PYTHONPATH=. .venv/bin/pytest tests/test_checkpointer_phase11.py tests/test_checkpoint_payload.py -q
PYTHONPATH=. .venv/bin/pytest tests/test_auth.py tests/test_swarm_sessions_api.py -q
```

Run the smallest relevant suite first, then broaden to `PYTHONPATH=. .venv/bin/pytest tests -q` when the change crosses layers.

## Tests as documentation

| Question | High-value tests |
|---|---|
| how routing gates work | `test_supervisor_routing_phase9.py` |
| how worker results merge | `test_reducer_phase6.py`, `test_reducer_phase8.py`, `test_subgraph_artifact_accumulation.py` |
| how checkpoint payloads are shaped | `test_checkpoint_payload.py`, `test_checkpointer_phase11.py` |
| how streaming is normalized | `test_swarm_streaming_events.py`, `test_swarm_graph_service_streaming.py` |
| how durable results/revisions work | `test_swarm_graph_service_phase11.py`, `test_swarm_revisions.py` |
| how auth and ownership work | `test_auth.py`, `test_swarm_sessions_api.py` |

## Safe change checklist

Before editing, identify the live wiring. After editing, check every contract that must move together:

- graph state field -> state type, empty state, nodes, persistence, schemas, tests;
- route -> handler, schema, router registration, auth/ownership, endpoint docs, tests;
- database field/table -> model, Alembic migration, startup required-table logic if applicable, service, tests;
- stream field -> normalizer whitelist, SSE docs, client contract, tests;
- graph node -> subagent implementation, topology, routing, state, tests, graph docs.

## Optional observability

Langfuse tracing is enabled only when the explicit flag and credentials are present. `SwarmGraphService` creates root operation spans and passes the LangChain callback through graph config. Treat tracing as diagnostic output, not as the source of truth for sessions or checkpoints.
