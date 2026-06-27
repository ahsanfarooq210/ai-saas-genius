# Change: Swarm streaming progress API

**Date:** 2026-06-28

## Goal

Expose live progress while a swarm run is creating the architecture, without streaming the final result body or leaking large/private graph state.

The final result remains durable by `thread_id` and is read through checkpoint/session endpoints after the stream emits `done`.

## What changed

### 1. Streaming endpoints

File: `app/api/v1/endpoints/swarm.py`

Added:

- `POST /api/v1/swarm/run/stream`
- `POST /api/v1/swarm/resume/stream`

Both return `text/event-stream` using `StreamingResponse`.

The existing blocking endpoints remain unchanged:

- `POST /api/v1/swarm/run`
- `POST /api/v1/swarm/resume`

## 2. Service streaming path

File: `app/services/swarm_graph_service.py`

Added:

- `stream_run(...)`
- `stream_resume(...)`
- shared `_stream_graph(...)`

The service calls LangGraph with:

```python
astream(
    graph_input,
    config=swarm_config(thread_id),
    stream_mode=["tasks", "updates"],
    subgraphs=True,
    version="v2",
)
```

This exposes both top-level parent graph events and nested architect/doc subgraph events.

On completion, the service calls `aget_state(...)`, finalizes app metadata through `_mark_session_done(...)`, and emits:

```text
event: done
data: {"thread_id":"...","status":"done"}
```

On failure, it marks the session failed, logs the traceback to the backend console with `logger.exception(...)`, and emits:

```text
event: error
data: {"thread_id":"...","status":"failed","message":"..."}
```

## 3. Stream normalization and sanitization

File: `app/agent/streaming.py`

Raw LangGraph stream chunks are normalized into stable progress events:

```json
{
  "thread_id": "stream-001",
  "type": "task_started",
  "node": "draft_architecture_node",
  "phase": "architecture",
  "message": "Drafting architecture",
  "iteration_count": 1,
  "payload": {}
}
```

The normalizer whitelists small metadata only. It does not expose:

- full `architecture_json`
- Mermaid source
- Markdown document body
- artifact `storage_key`
- artifact `url`
- full reviewer feedback
- full final `SwarmRunResponse`

Reducer outputs may arrive as LangGraph `Overwrite(value=...)` wrappers. The normalizer unwraps `.value` before counting generated diagrams/docs so reducer progress events do not crash the stream.

## 4. Public schemas

File: `app/schemas/swarm.py`

Added lightweight event models:

- `SwarmStreamProgressEvent`
- `SwarmStreamDoneEvent`
- `SwarmStreamErrorEvent`

These document the wire shape even though `StreamingResponse` does not use a FastAPI `response_model`.

## Client contract

Typical flow:

```text
POST /api/v1/swarm/run/stream
  -> progress events
  -> event: done

GET /api/v1/swarm/state/{thread_id}
GET /api/v1/swarm/sessions/{thread_id}
  -> durable final state/session metadata
```

Do not call `POST /api/v1/swarm/run` after a streaming run just to retrieve the result. That starts the non-streaming run path. Use the same `thread_id` with the read endpoints.

## Files touched

| Area | Files |
|------|-------|
| API | `app/api/v1/endpoints/swarm.py` |
| Service | `app/services/swarm_graph_service.py` |
| Streaming normalization | `app/agent/streaming.py` |
| Schemas | `app/schemas/swarm.py` |
| Tests | `tests/test_swarm_streaming_events.py`, `tests/test_swarm_graph_service_streaming.py` |
| Docs | `docs/current/streaming.md`, `docs/current/project-state.md`, `docs/current/how-the-swarm-graph-works.md` |

## Tests

```bash
pytest tests/test_swarm_streaming_events.py \
       tests/test_swarm_graph_service_streaming.py -q
```

Full suite at implementation time:

```text
68 passed
```

## Contract to preserve

- Streaming endpoints are additive; do not change `/run` or `/resume` response contracts.
- Progress events must stay sanitized and small.
- Final results should remain retrievable by `thread_id` through normal GET endpoints.
- Keep `stream_mode=["tasks", "updates"]` and `subgraphs=True` unless the event contract is intentionally redesigned.
- Keep reducer `Overwrite(value=...)` handling in the normalizer.
- Log server-side stream failures before emitting the SSE `error` event.
