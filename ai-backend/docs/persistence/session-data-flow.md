# Session data flow

This document explains the complete flow for saving session data in the database.

## Tables

The user-facing session result and its revision history are stored across four app-managed tables.

| Table | Purpose |
|-------|---------|
| `sessions` | one row per `thread_id`; authenticated owner, run status, counts, final graph-state projection |
| `session_artifacts` | final generated diagram/doc artifact metadata |
| `debate_logs` | final reviewer feedback entries |
| `swarm_revisions` | per-version instruction, status, timestamps, and complete successful result state |

Raw Mermaid and Markdown content is stored in the artifact store. The database stores artifact metadata and URLs.

## What is stored in `sessions`

`sessions` stores:

- identity and status: `thread_id`, `user_id`, `requirement`, `status`, `current_revision`, `created_at`, `completed_at`
- counts: `complexity`, `diagram_count`, `doc_count`
- architecture result: `architecture_draft`, `architecture_json`, `component_list`, `current_architecture_mermaid`
- plans: `diagram_plan`, `doc_plan`
- supervisor state: `docs_complete`, `iteration_count`, `next_agent`
- reviewer state: `scalability_feedback`, `security_feedback`
- optional notes: `deep_dive_notes`

These columns are a final graph-state projection. They exist so `GET /api/v1/swarm/sessions/{thread_id}` can return useful result data without invoking LangGraph.

## Blocking run flow

Endpoint:

```text
POST /api/v1/swarm/run
```

Flow:

```text
swarm.py
  -> service.run(task_requirement, thread_id, db, user_id)
       -> _mark_session_running(...)
            -> insert/update the owned sessions row as running
            -> commit
       -> graph.ainvoke(empty_swarm_state, swarm_config(thread_id))
       -> _mark_session_done(...)
            -> update sessions status, counts, graph-state fields
            -> replace debate_logs rows
            -> replace session_artifacts rows
            -> commit
       -> return final graph result
  -> SwarmRunResponse.model_validate(result)
```

The `running` row is committed before graph execution. That gives the app a durable record that the run started even if the graph takes a long time.

If the graph raises:

```text
exception
  -> _mark_session_failed(...)
       -> sessions.status = failed
       -> completed_at = now
       -> commit
  -> exception re-raised
```

## Streaming run flow

Endpoint:

```text
POST /api/v1/swarm/run/stream
```

Flow:

```text
swarm.py
  -> verify a missing thread is available or an existing thread is owned
  -> service.stream_run(task_requirement, thread_id, db, user_id)
       -> _mark_session_running(...)
       -> graph.astream(empty_swarm_state, stream_mode=["tasks", "updates"], subgraphs=True)
            -> normalize chunks
            -> yield SSE progress events
       -> graph.aget_state(swarm_config(thread_id))
       -> _mark_session_done(snapshot.values)
       -> yield SSE done event
```

The stream does not send the final result body. After `event: done`, the client should call:

```text
GET /api/v1/swarm/sessions/{thread_id}
```

If the stream fails, the service logs the backend traceback, marks the session failed, and emits an SSE `error` event.

## Revision flow

`POST /api/v1/swarm/revise` and `/revise/stream` reserve the next revision number under a session-row lock. The service rejects unknown/non-owned sessions and sessions already marked `running`.

The new graph input is built from the latest successful session/artifact/debate projection. It keeps the original requirement and existing architecture but resets supervisor completion and reviewer state, then forces the first route through `architect_graph` with `revision_pending=true`.

On success, `_mark_session_done(...)` atomically replaces the current session projection and marks the reserved revision `done` with the complete final state. On failure, only the revision/session statuses change; `current_revision`, architecture columns, artifact rows, and debate rows remain on the preceding successful version.

## Blocking resume flow

Endpoint:

```text
POST /api/v1/swarm/resume
```

Flow:

```text
swarm.py
  -> service.resume(thread_id, db, user_id)
       -> verify sessions.user_id ownership
       -> graph.ainvoke(None, swarm_config(thread_id))
       -> _mark_session_done(result)
       -> return final graph result
```

Passing `None` is the resume signal for LangGraph. The checkpointer loads the latest state for the configured `thread_id`.

The blocking resume path does not currently mark the row `running` before invoking the graph. It updates the row after success, or marks it failed if an exception is raised.

## Streaming resume flow

Endpoint:

```text
POST /api/v1/swarm/resume/stream
```

Flow:

```text
swarm.py
  -> verify sessions.user_id ownership
  -> service.stream_resume(thread_id, db, user_id)
       -> _mark_session_resume_running(...)
       -> graph.astream(None, swarm_config(thread_id), ...)
       -> graph.aget_state(...)
       -> _mark_session_done(snapshot.values)
       -> yield SSE done event
```

Streaming resume requires an owned app session row and marks it `running` before graph execution. Checkpoint state is not exposed when the authorization source (`sessions.user_id`) is missing or belongs to another user.

## Finalization details

`_mark_session_done(...)` is the only service method that finalizes app result data.

It writes:

1. `sessions.status = done`
2. `sessions.completed_at = now`
3. complexity and artifact counts
4. final graph-state projection columns
5. fresh debate log rows
6. fresh artifact rows
7. the successful `swarm_revisions.result_state` and `sessions.current_revision`

Before inserting debate logs and artifacts, it deletes existing rows for the same `thread_id`. This makes rerun/resume finalization replace the previous final result instead of duplicating rows.

## Artifact rows

For diagrams, the service inserts rows from final `generated_diagrams` entries only when both `storage_key` and `url` are present.

For docs, it inserts rows from final `generated_docs` entries only when both `storage_key` and `url` are present.

This matches the graph reducers: failed diagrams without storage metadata are filtered before final state, and app persistence also skips incomplete artifact entries.

## Session read flow

Endpoint:

```text
GET /api/v1/swarm/sessions/{thread_id}
```

Flow:

```text
swarm.py
  -> service.get_session(thread_id, db, user_id)
       -> load sessions row filtered by owner
       -> load session_artifacts rows
       -> split artifacts into generated_diagrams/generated_docs
       -> load debate_logs rows
       -> return response dict
  -> SwarmSessionResponse.model_validate(...)
```

If the session row is missing or belongs to another user, the API returns `404`.

`GET /api/v1/swarm/sessions?limit=&offset=` filters by the authenticated `user_id` and returns newest-first summary rows. Legacy rows with `user_id = NULL` are intentionally absent from authenticated lists.

## Difference from checkpoint state

`GET /api/v1/swarm/state/{thread_id}` reads the LangGraph checkpoint snapshot and returns a checkpoint-shaped summary.

`GET /api/v1/swarm/sessions/{thread_id}` reads app tables and returns the durable result projection.

Use `/state` for checkpoint/runtime inspection. Use `/sessions` for final result retrieval after a blocking or streaming run completes.

## Existing rows after migrations

Migration `003_add_session_graph_state.py` adds nullable graph-state columns to `sessions`. Migration `004_add_swarm_revisions.py` adds `current_revision` and revision history.

Existing completed rows are marked as revision 1. Their full baseline revision snapshot is lazily materialized from the current app-table projection when history or the first revision is requested. Migration `005_add_session_ownership.py` adds nullable ownership; legacy `NULL` owners are not assigned automatically.

## Related docs

- [checkpointer-postgres-alembic.md](checkpointer-postgres-alembic.md)
- [`../graphs/overview.md`](../graphs/overview.md)
- [`../current/streaming.md`](../current/streaming.md)
