# Streaming progress

**Audience:** backend and frontend developers integrating long-running swarm runs.

**Live code wins:** This document describes the implementation in `app/api/v1/endpoints/swarm.py`, `app/services/swarm_graph_service.py`, and `app/agent/streaming.py`.

---

## What streaming does

Streaming is for **progress only**. It tells the client what the graph is doing while the architecture is being created:

- which node started
- which node completed
- small sanitized state updates, such as component count, diagram count, doc count, reviewer status
- final `done` or `error` event

It does **not** stream the full final `SwarmRunResponse`, full `architecture_json`, Mermaid source, Markdown docs, artifact URLs, or full reviewer feedback.

The durable result remains available through checkpoint/session reads by `thread_id`.

```text
POST /api/v1/swarm/run/stream       -> live progress events
POST /api/v1/swarm/revise/stream    -> live progress events for a follow-up instruction
POST /api/v1/swarm/resume/stream    -> live progress events for a resumed thread
GET  /api/v1/swarm/state/{id}       -> checkpoint summary after/during the run
GET  /api/v1/swarm/sessions/{id}    -> persisted graph-state, session, artifact, and debate metadata
```

Do not call `POST /api/v1/swarm/run` after a streaming run just to fetch the result; that is a separate run path. Reuse the same `thread_id` with the GET endpoints.

---

## Why progress and results are separate

The stream is a long-lived transport. It is useful for transient UI updates, but it is not a durable result store. Separating progress from final reads gives the client a clean recovery path:

1. Open stream.
2. Render progress events.
3. Receive `event: done`.
4. Fetch final state/session data by `thread_id`.

If the browser refreshes or the network drops, the client can reconnect or fetch the current state by `thread_id`. Final data does not depend on the client seeing the last stream chunk.

---

## API contract

### Start and stream a new run

```http
POST /api/v1/swarm/run/stream
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "task_requirement": "Design a URL shortener with analytics",
  "thread_id": "stream-001"
}
```

### Resume and stream an existing thread

```http
POST /api/v1/swarm/resume/stream
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "thread_id": "stream-001"
}
```

Both endpoints return `text/event-stream`.

### Revise and stream an existing architecture

```http
POST /api/v1/swarm/revise/stream
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "thread_id": "stream-001",
  "instruction": "Replace the local cache with Redis."
}
```

This starts a new revision turn; it is not checkpoint resume. It returns the same progress-only SSE contract and promotes the new result only after the graph succeeds.

---

## SSE message format

Each message uses normal Server-Sent Events framing:

```text
event: progress
data: {"thread_id":"stream-001","type":"task_started","node":"supervisor_node","phase":"supervisor","message":"Choosing the next graph step","iteration_count":1,"payload":{"next_agent":"architect_graph","iteration_count":1}}

```

The API formats events in `app/api/v1/endpoints/swarm.py`:

- `event`: `progress`, `done`, or `error`
- `data`: compact JSON on one line

`StreamingResponse` is returned with:

- `media_type="text/event-stream"`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no`

---

## Progress event shape

Progress events are normalized in `app/agent/streaming.py`.

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

| Field | Meaning |
|-------|---------|
| `thread_id` | Checkpoint/session id for this graph run |
| `type` | `task_started`, `task_completed`, or `state_update` |
| `node` | Raw LangGraph node name |
| `phase` | `supervisor`, `architecture`, `diagram`, `documentation`, `review`, or `unknown` |
| `message` | Human-readable status for UI display |
| `iteration_count` | Supervisor iteration or worker iteration when known |
| `payload` | Small node-specific metadata; never full graph output |

### Example payloads

| Node | Payload |
|------|---------|
| `supervisor_node` | `{"next_agent":"architect_graph","iteration_count":1}` |
| `draft_architecture_node` | `{"component_count":7}` |
| `score_complexity_node` | `{"complexity_score":6,"diagram_count":9,"doc_count":8}` |
| `diagram_generator_node` | `{"diagram_type":"overview","component_slug":"","iteration":1,"valid":true}` |
| `reduce_diagrams_node` | `{"generated_diagram_count":9}` |
| `document_generator_node` | `{"title":"System Overview","component_slug":""}` |
| `reduce_docs_node` | `{"generated_doc_count":8,"docs_complete":true}` |
| `scalability_node`, `security_node` | `{"status":"APPROVED"}` or `{"status":"REJECTED"}` |

---

## Done and error events

When the graph reaches `END`, the service finalizes DB metadata from the checkpoint snapshot and emits:

```text
event: done
data: {"thread_id":"stream-001","status":"done"}

```

When the graph or stream normalizer raises, the service marks the session failed, logs a traceback to the backend console, and emits:

```text
event: error
data: {"thread_id":"stream-001","status":"failed","message":"..."}

```

Client disconnects raise `asyncio.CancelledError`; the service marks the session failed and re-raises cancellation.

---

## Service implementation

`SwarmGraphService.stream_run(...)`:

1. Marks the `sessions` row `running`.
2. Builds `_empty_swarm_state(task_requirement, thread_id)`.
3. Calls `_stream_graph(...)`.

`SwarmGraphService.stream_resume(...)`:

1. Marks an existing session `running` if it exists.
2. Calls `_stream_graph(None, thread_id, db=db)`, matching existing resume semantics.

`SwarmGraphService.stream_revise(...)` reserves a revision, constructs graph input from the latest successful app projection, then calls `_stream_graph(...)` with that state. Unknown threads fail before response streaming with `404`, and active threads fail with `409`.

`_stream_graph(...)` calls the compiled LangGraph runtime:

```python
self._graph.astream(
    graph_input,
    config=swarm_config(thread_id),
    stream_mode=["tasks", "updates"],
    subgraphs=True,
    version="v2",
)
```

`stream_mode=["tasks", "updates"]` provides both node lifecycle events and state update events. `subgraphs=True` exposes nested architect/doc subgraph nodes instead of only opaque parent nodes.

After the async stream completes, the service calls `aget_state(...)`, reads `snapshot.values`, and reuses `_mark_session_done(...)` so DB finalization matches the non-streaming run path.

---

## Normalization and sanitization

Raw LangGraph chunks are not exposed directly. `normalize_stream_chunk(...)` converts them into stable public events.

The normalizer deliberately whitelists fields by node. It strips:

- `task_requirement`
- full `architecture_json`
- Mermaid source
- Markdown document body
- `storage_key`
- artifact `url`
- full reviewer feedback

Reducer outputs from `reduce_diagrams_node` and `reduce_docs_node` may arrive as LangGraph `Overwrite(value=...)` wrappers. The normalizer unwraps `.value` before counting entries so progress events can safely report artifact counts.

---

## How to test manually

Start the backend:

```bash
uvicorn app.main:app --reload
```

Run with curl:

```bash
curl -N -X POST http://localhost:8000/api/v1/swarm/run/stream \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"task_requirement":"Design a URL shortener with analytics","thread_id":"curl-stream-001"}'
```

After `event: done`, fetch state/session data:

```bash
curl http://localhost:8000/api/v1/swarm/state/curl-stream-001 \
  -H "Authorization: Bearer <access-token>"
curl http://localhost:8000/api/v1/swarm/sessions/curl-stream-001 \
  -H "Authorization: Bearer <access-token>"
```

`/sessions/{thread_id}` is the durable app-table result read. It includes the final graph-state projection mirrored into the `sessions` row, including architecture fields, plans, reviewer feedback, supervisor state, final artifact rows, and debate logs. It intentionally reads from app tables, not directly from the live SSE stream.

Postman can call the same `POST` endpoint with `Accept: text/event-stream`, but if it buffers the response, use `curl -N` to verify true chunking.

---

## Tests

Streaming behavior is covered by:

```bash
pytest tests/test_swarm_streaming_events.py \
       tests/test_swarm_graph_service_streaming.py -q
```

Key cases:

- top-level and nested subgraph event normalization
- sanitization of large/private fields
- reducer `Overwrite(value=...)` handling
- service start/resume stream inputs
- session finalization from checkpoint snapshot
- error logging plus SSE `error` event
- route-level SSE framing
