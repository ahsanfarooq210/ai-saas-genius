# Session data flow

This document explains the complete flow for saving session data in the database.

## Tables

The user-facing session result is stored across three app-managed tables.

| Table | Purpose |
|-------|---------|
| `sessions` | one row per `thread_id`; run status, counts, final graph-state projection |
| `session_artifacts` | final generated diagram/doc artifact metadata |
| `debate_logs` | final reviewer feedback entries |

Raw Mermaid and Markdown content is stored in the artifact store. The database stores artifact metadata and URLs.

## What is stored in `sessions`

`sessions` stores:

- identity and status: `thread_id`, `requirement`, `status`, `created_at`, `completed_at`
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
  -> service.run(task_requirement, thread_id, db)
       -> _mark_session_running(...)
            -> insert/update sessions row as running
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
  -> service.stream_run(task_requirement, thread_id, db)
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

## Blocking resume flow

Endpoint:

```text
POST /api/v1/swarm/resume
```

Flow:

```text
swarm.py
  -> service.resume(thread_id, db)
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
  -> service.stream_resume(thread_id, db)
       -> _mark_session_resume_running(...)
       -> graph.astream(None, swarm_config(thread_id), ...)
       -> graph.aget_state(...)
       -> _mark_session_done(snapshot.values)
       -> yield SSE done event
```

If the session row already exists, streaming resume marks it `running` before graph execution. If the row does not exist, the graph may still resume from LangGraph checkpoint state, but there is no app session row to update.

## Finalization details

`_mark_session_done(...)` is the only service method that finalizes app result data.

It writes:

1. `sessions.status = done`
2. `sessions.completed_at = now`
3. complexity and artifact counts
4. final graph-state projection columns
5. fresh debate log rows
6. fresh artifact rows

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
  -> service.get_session(thread_id, db)
       -> load sessions row
       -> load session_artifacts rows
       -> split artifacts into generated_diagrams/generated_docs
       -> load debate_logs rows
       -> return response dict
  -> SwarmSessionResponse.model_validate(...)
```

If the session row is missing, the API returns `404`.

## Difference from checkpoint state

`GET /api/v1/swarm/state/{thread_id}` reads the LangGraph checkpoint snapshot and returns a checkpoint-shaped summary.

`GET /api/v1/swarm/sessions/{thread_id}` reads app tables and returns the durable result projection.

Use `/state` for checkpoint/runtime inspection. Use `/sessions` for final result retrieval after a blocking or streaming run completes.

## Existing rows after migrations

Migration `003_add_session_graph_state.py` adds nullable graph-state columns to `sessions`.

Old rows can still be read. Missing values are returned as empty defaults by the service response. Those rows get full graph-state fields after the next successful run or resume for the same `thread_id`.

## Related docs

- [checkpointer-postgres-alembic.md](checkpointer-postgres-alembic.md)
- [`../graphs/overview.md`](../graphs/overview.md)
- [`../current/streaming.md`](../current/streaming.md)

