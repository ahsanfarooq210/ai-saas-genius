# Frontend API guide

This document describes the live HTTP API exposed by the files in
`app/api/v1/endpoints/`. It is written for frontend agents that need to build a
typed API layer.

Live code wins over this guide. The registered v1 routes are defined in
`app/api/v1/router.py`; today it only includes `app/api/v1/endpoints/swarm.py`.
The auth schemas in `app/schemas/auth.py` are scaffolded, but auth endpoints are
not currently registered.

## Base paths

| Scope | Base path | Source |
|-------|-----------|--------|
| Health check | `/health` | `app/main.py` |
| Swarm API | `/api/v1/swarm` | `app/main.py` + `app/api/v1/router.py` |

The frontend should treat `thread_id` as the stable client/session key for a
swarm run. Use the same `thread_id` to stream progress, resume work, read
checkpoint state, and read persisted session results.

## Endpoint summary

| Method | Path | Purpose | Returns |
|--------|------|---------|---------|
| `GET` | `/health` | Check that the backend app is alive | `{"status":"ok"}` |
| `POST` | `/api/v1/swarm/run` | Start a new blocking swarm run | Full final graph state |
| `POST` | `/api/v1/swarm/run/stream` | Start a new streaming swarm run | SSE progress events only |
| `POST` | `/api/v1/swarm/resume` | Resume an existing checkpoint and wait for final state | Full final graph state |
| `POST` | `/api/v1/swarm/resume/stream` | Resume an existing checkpoint with progress events | SSE progress events only |
| `GET` | `/api/v1/swarm/state/{thread_id}` | Read current LangGraph checkpoint summary | Checkpoint summary |
| `GET` | `/api/v1/swarm/sessions/{thread_id}` | Read persisted app session and artifact metadata | Durable session result |
| `GET` | `/api/v1/swarm/graphs` | List graph topology IDs available for rendering | Graph list |
| `GET` | `/api/v1/swarm/graphs/{graph_id}/mermaid` | Render one graph topology as Mermaid source | Mermaid text |

## Common request models

### Start run request

Used by `POST /api/v1/swarm/run` and `POST /api/v1/swarm/run/stream`.

```ts
type SwarmRunRequest = {
  task_requirement: string;
  thread_id: string;
};
```

Both fields are required and must be non-empty strings.

### Resume request

Used by `POST /api/v1/swarm/resume` and
`POST /api/v1/swarm/resume/stream`.

```ts
type SwarmResumeRequest = {
  thread_id: string;
};
```

## Artifact contract

Generated diagrams and docs are returned as metadata with hosted URLs. The API
does not return raw Mermaid files or raw Markdown artifact bodies in the
session artifact lists.

```ts
type Artifact = {
  artifact_type: "diagram" | "doc" | string;
  name: string;
  component_slug: string;
  storage_key: string;
  url: string;
  iteration: number | null;
};
```

Frontend behavior:

- Render or download artifacts from `url`.
- Use `component_slug` to group docs and diagrams for the same component.
- Keep `storage_key` for backend correlation/debugging, not for direct browser
  fetches.
- Diagram artifacts use `iteration` as a number. Doc artifacts currently use
  `iteration: null` in the persisted session response.

## Blocking run

```http
POST /api/v1/swarm/run
Content-Type: application/json
```

```json
{
  "task_requirement": "Design a multi-tenant SaaS analytics platform",
  "thread_id": "project-analytics-001"
}
```

Purpose:

- Creates or updates the app `sessions` row as `running`.
- Invokes the compiled LangGraph swarm from a fresh empty state for the given
  requirement and `thread_id`.
- Persists final session fields, debate logs, and artifact metadata when the
  graph finishes.
- Returns the full final graph state in the response body.

Use this endpoint when the UI can wait for the whole graph run before showing
results. For long-running UX, prefer the streaming endpoint.

Response shape:

```ts
type SwarmRunResponse = {
  task_requirement: string;
  architecture_draft: string;
  architecture_json: Record<string, unknown>;
  component_list: string[];
  current_architecture_mermaid: string;
  complexity_score: number;
  diagram_plan: string[];
  doc_plan: string[];
  deep_dive_notes: string;
  generated_diagrams: DiagramResult[];
  thread_id: string;
  generated_docs: DocResult[];
  docs_complete: boolean;
  iteration_count: number;
  next_agent: string;
  scalability_feedback: string;
  security_feedback: string;
  debate_logs: DebateLog[];
};

type DiagramResult = {
  diagram_type: string;
  component_slug: string;
  storage_key: string;
  url: string;
  iteration: number;
};

type DocResult = {
  title: string;
  component_slug: string;
  storage_key: string;
  url: string;
};

type DebateLog = {
  agent: string;
  feedback: string;
  status: string;
  iteration: number;
};
```

## Streaming run

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

Purpose:

- Starts a new swarm run.
- Sends Server-Sent Events while graph nodes start, finish, and write small
  sanitized state updates.
- Does not send the full final result body.

After the stream emits `event: done`, fetch the durable result:

```text
GET /api/v1/swarm/sessions/{thread_id}
```

Do not call `POST /api/v1/swarm/run` after a streaming run just to fetch final
data. That starts the blocking run path.

### SSE format

Every SSE message uses this framing:

```text
event: progress
data: {"thread_id":"stream-001","type":"task_started","node":"supervisor_node","phase":"supervisor","message":"Choosing the next graph step","iteration_count":1,"payload":{}}

```

Possible event names:

| Event | Meaning |
|-------|---------|
| `progress` | A graph task started, completed, or wrote a sanitized update |
| `done` | The graph reached `END`; fetch final data by `thread_id` |
| `error` | The stream failed; the session is marked failed when a row exists |

Progress data:

```ts
type SwarmProgressEvent = {
  thread_id: string;
  type: "task_started" | "task_completed" | "state_update";
  node: string;
  phase:
    | "supervisor"
    | "architecture"
    | "diagram"
    | "documentation"
    | "review"
    | "unknown";
  message: string;
  iteration_count: number | null;
  payload: Record<string, unknown>;
};

type SwarmDoneEvent = {
  thread_id: string;
  status: "done";
};

type SwarmErrorEvent = {
  thread_id: string;
  status: "failed";
  message: string;
};
```

Common progress payloads:

| Node | Example payload |
|------|-----------------|
| `supervisor_node` | `{"next_agent":"architect_graph","iteration_count":1}` |
| `draft_architecture_node` | `{"component_count":7}` |
| `score_complexity_node` | `{"complexity_score":6,"diagram_count":9,"doc_count":8}` |
| `diagram_generator_node` | `{"diagram_type":"overview","component_slug":"","iteration":1,"valid":true}` |
| `reduce_diagrams_node` | `{"generated_diagram_count":9}` |
| `document_generator_node` | `{"title":"System Overview","component_slug":""}` |
| `reduce_docs_node` | `{"generated_doc_count":8,"docs_complete":true}` |
| `scalability_node` / `security_node` | `{"status":"APPROVED"}` |

Frontend behavior:

- Use streaming events for progress UI only.
- Store the `thread_id` before opening the stream so the UI can recover after
  refresh or network loss.
- On `done`, call `GET /api/v1/swarm/sessions/{thread_id}`.
- On `error`, show `message` and optionally call
  `GET /api/v1/swarm/sessions/{thread_id}` to check persisted status.

## Blocking resume

```http
POST /api/v1/swarm/resume
Content-Type: application/json
```

```json
{
  "thread_id": "stream-001"
}
```

Purpose:

- Resumes the LangGraph checkpoint for `thread_id`.
- Waits until the graph returns final state.
- Persists final session fields and artifact metadata on success.
- Returns the same `SwarmRunResponse` shape as `POST /api/v1/swarm/run`.

Use this when the backend has an interrupted or paused checkpoint and the UI can
wait for completion. If the graph has no checkpoint for the supplied
`thread_id`, the request can fail from the graph/checkpointer layer.

## Streaming resume

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

Purpose:

- Resumes an existing checkpoint.
- Streams the same `progress`, `done`, and `error` events as
  `POST /api/v1/swarm/run/stream`.
- If an app session row already exists, marks it `running` before resuming.

After `done`, fetch:

```text
GET /api/v1/swarm/sessions/{thread_id}
```

## Checkpoint state

```http
GET /api/v1/swarm/state/{thread_id}
```

Purpose:

- Reads the current LangGraph checkpoint snapshot.
- Useful for in-progress status, debugging, recovery, and lightweight result
  summaries.
- Does not require the app session row to exist.

Response shape:

```ts
type SwarmCheckpointResponse = {
  thread_id: string;
  next: string[];
  component_list: string[];
  complexity_score: number;
  diagram_plan: string[];
  generated_diagram_count: number;
  generated_diagrams: CheckpointDiagram[];
  generated_doc_count: number;
  generated_docs: CheckpointDoc[];
  docs_complete: boolean;
  iteration_count: number;
  next_agent: string;
  scalability_feedback: string;
  security_feedback: string;
  debate_log_count: number;
  debate_logs: CheckpointDebateLog[];
};

type CheckpointDiagram = {
  diagram_type: string;
  component_slug: string;
  valid: boolean;
  storage_key: string;
  url: string;
  iteration: number;
};

type CheckpointDoc = {
  title: string;
  component_slug: string;
  storage_key: string;
  url: string;
};

type CheckpointDebateLog = {
  agent: string;
  status: string;
  iteration: number;
};
```

Notes:

- `next` is empty when the graph reached `END`.
- Checkpoint artifact items include `storage_key` and `url` when artifacts were
  persisted.
- `generated_diagram_count`, `generated_doc_count`, and `debate_log_count` are
  convenient counters for UI summaries.

## Persisted session

```http
GET /api/v1/swarm/sessions/{thread_id}
```

Purpose:

- Reads durable app-table data for a completed, running, or failed swarm
  session.
- Returns final graph-state projection, reviewer debate logs, and persisted
  artifact metadata.
- This is the preferred final read after streaming completes.

Success response:

```ts
type SwarmSessionResponse = {
  thread_id: string;
  requirement: string;
  status: string;
  complexity: number | null;
  diagram_count: number | null;
  doc_count: number | null;
  architecture_draft: string;
  architecture_json: Record<string, unknown>;
  component_list: string[];
  current_architecture_mermaid: string;
  diagram_plan: string[];
  doc_plan: string[];
  deep_dive_notes: string;
  docs_complete: boolean;
  iteration_count: number;
  next_agent: string;
  scalability_feedback: string;
  security_feedback: string;
  debate_logs: DebateLog[];
  created_at: string | null;
  completed_at: string | null;
  generated_diagrams: Artifact[];
  generated_docs: Artifact[];
};
```

Errors:

- `404` with `{"detail":"Unknown thread_id: <thread_id>"}` when no app session
  row exists.

Frontend behavior:

- Use `status` for run state: current service values are `running`, `done`, and
  `failed`.
- Use `generated_diagrams` and `generated_docs` as the durable artifact source.
- Use `created_at` and `completed_at` as ISO timestamp strings when present.

## Graph list

```http
GET /api/v1/swarm/graphs
```

Purpose:

- Lists graph topology IDs that can be rendered as Mermaid.
- Useful for developer tools, graph viewers, and debug screens.

Response:

```ts
type SwarmGraphListResponse = {
  graphs: SwarmGraphInfo[];
};

type SwarmGraphInfo = {
  graph_id: string;
  name: string;
  description: string;
  supports_xray: boolean;
};
```

Current graph IDs:

| `graph_id` | Meaning | `supports_xray` |
|------------|---------|-----------------|
| `supervisor` | Parent graph with supervisor routing, subgraphs, and reviewers | `true` |
| `architect` | Architect subgraph: draft, score, diagram fan-out, reduce | `false` |
| `doc_generator` | Documentation subgraph: doc fan-out and reduce | `false` |

## Graph Mermaid

```http
GET /api/v1/swarm/graphs/{graph_id}/mermaid?xray=false
```

Purpose:

- Returns Mermaid flowchart source for a registered LangGraph topology.
- `xray=true` expands nested subgraphs only for graph IDs that support xray.

Response:

```ts
type SwarmGraphMermaidResponse = {
  graph_id: string;
  mermaid: string;
  xray: boolean;
};
```

Errors:

- `404` with `{"detail":"Unknown graph_id: <graph_id>"}` when the graph ID is
  not registered.

Frontend behavior:

- Call `GET /api/v1/swarm/graphs` first if the UI lets users choose graphs.
- Render `mermaid` with the frontend Mermaid renderer.
- Only enable the xray toggle when `supports_xray` is `true`.

## Recommended frontend API layer

Minimum useful client functions:

```ts
async function startSwarmRun(input: SwarmRunRequest): Promise<SwarmRunResponse>;
async function resumeSwarmRun(input: SwarmResumeRequest): Promise<SwarmRunResponse>;
async function getSwarmState(threadId: string): Promise<SwarmCheckpointResponse>;
async function getSwarmSession(threadId: string): Promise<SwarmSessionResponse>;
async function listSwarmGraphs(): Promise<SwarmGraphListResponse>;
async function getSwarmGraphMermaid(
  graphId: string,
  options?: { xray?: boolean },
): Promise<SwarmGraphMermaidResponse>;
function streamSwarmRun(
  input: SwarmRunRequest,
  handlers: SwarmStreamHandlers,
): AbortController;
function streamSwarmResume(
  input: SwarmResumeRequest,
  handlers: SwarmStreamHandlers,
): AbortController;

type SwarmStreamHandlers = {
  onProgress?: (event: SwarmProgressEvent) => void;
  onDone?: (event: SwarmDoneEvent) => void;
  onError?: (event: SwarmErrorEvent) => void;
};
```

Implementation notes:

- Native `EventSource` cannot send a JSON `POST` body. Use `fetch` streaming,
  `@microsoft/fetch-event-source`, or another SSE client that supports POST
  bodies.
- The stream response headers include `Cache-Control: no-cache` and
  `X-Accel-Buffering: no`.
- Treat non-2xx JSON responses as API errors. For stream endpoints, also handle
  `event: error`.
- The backend does not require auth for the registered swarm routes today.

