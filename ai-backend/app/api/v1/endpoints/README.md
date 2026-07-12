# Frontend API guide

This document describes the live HTTP API exposed by the files in
`app/api/v1/endpoints/`. It is written for frontend agents that need to build a
typed API layer.

Live code wins over this guide. The registered v1 routes are defined in
`app/api/v1/router.py`; today it includes `app/api/v1/endpoints/auth.py` and
`app/api/v1/endpoints/swarm.py`.

## Base paths

| Scope | Base path | Source |
|-------|-----------|--------|
| Health check | `/health` | `app/main.py` |
| Auth API | `/api/v1/auth` | `app/api/v1/endpoints/auth.py` |
| Swarm API | `/api/v1/swarm` | `app/main.py` + `app/api/v1/router.py` |

The frontend should treat `thread_id` as the stable client/session key for a
swarm run. Use the same `thread_id` to stream progress, resume work, read
checkpoint state, and read persisted session results.

## Authentication model

`JWTAuthMiddleware` protects `/api/v1/*` by default, with these public paths:

- `/api/v1/auth`
- `/health`
- `/docs`
- `/redoc`
- `/openapi.json`

**Cookies are now the primary auth transport.** `signup`, `login`/`signin`,
and `refresh` set `accessToken` and `refreshToken` cookies on the response,
in addition to still returning tokens in the JSON body (see "Dual-mode
migration" below).

| Cookie | HttpOnly | Secure | SameSite | Path |
|--------|----------|--------|----------|------|
| `accessToken` | Yes | Yes | `Lax` | `/` |
| `refreshToken` | Yes | Yes | `Strict` | `/api/v1/auth/refresh` only |

Token resolution precedence for protected requests: **`Authorization` header
first, then the `accessToken` cookie.** A browser client that lets the cookie
do the work does not need to set the header at all — just use
`credentials: "include"` / `withCredentials: true` so the browser sends
cookies cross-origin, and make sure the frontend origin is in the backend's
`CORS_ALLOWED_ORIGINS`.

The bearer header is optional/deprecated going forward but still fully
supported — existing code that manually attaches
`Authorization: Bearer <token>` keeps working unchanged.

Protected endpoints:

- All `/api/v1/swarm/*` routes
- `GET /api/v1/auth/me`

Public endpoints (no JWT required):

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/signin`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /health`

## Dual-mode migration

`TokenResponse` (`access_token`, `refresh_token`, `token_type`) is still
returned in the body of `signup`, `login`, `signin`, and `refresh` so any code
still reading `response.data.access_token` keeps working during the
transition to cookies. Once the frontend stops reading those fields (relying
on cookies + `/auth/me` instead), the body fields should be dropped — this is
a migration aid, not a long-term contract.

## Logout

`POST /api/v1/auth/logout` clears both auth cookies. It does not require a
request body. There is currently **no server-side token revocation** — no
token blacklist/allowlist table exists — so a bearer token captured outside
the cookie flow remains valid until it naturally expires even after logout.

## Endpoint summary

| Method | Path | Purpose | Returns |
|--------|------|---------|---------|
| `GET` | `/health` | Check that the backend app is alive | `{"status":"ok"}` |
| `POST` | `/api/v1/auth/signup` | Register a user and issue tokens | Access and refresh tokens |
| `POST` | `/api/v1/auth/signin` | Sign in with email and password | Access and refresh tokens |
| `POST` | `/api/v1/auth/login` | Alias for signin | Access and refresh tokens |
| `POST` | `/api/v1/auth/refresh` | Exchange a refresh token for new tokens | Access and refresh tokens |
| `POST` | `/api/v1/auth/logout` | Clear auth cookies (no server-side revocation yet) | `{"detail": "Logged out"}` |
| `GET` | `/api/v1/auth/me` | Read the current authenticated user | User profile |
| `POST` | `/api/v1/swarm/run` | Start a new blocking swarm run | Full final graph state |
| `POST` | `/api/v1/swarm/run/stream` | Start a new streaming swarm run | SSE progress events only |
| `POST` | `/api/v1/swarm/resume` | Resume an existing checkpoint and wait for final state | Full final graph state |
| `POST` | `/api/v1/swarm/resume/stream` | Resume an existing checkpoint with progress events | SSE progress events only |
| `GET` | `/api/v1/swarm/state/{thread_id}` | Read current LangGraph checkpoint summary | Checkpoint summary |
| `GET` | `/api/v1/swarm/sessions` | List sessions owned by the authenticated user | Newest-first session summaries |
| `GET` | `/api/v1/swarm/sessions/{thread_id}` | Read persisted app session and artifact metadata | Durable session result |
| `GET` | `/api/v1/swarm/graphs` | List graph topology IDs available for rendering | Graph list |
| `GET` | `/api/v1/swarm/graphs/{graph_id}/mermaid` | Render one graph topology as Mermaid source | Mermaid text |

## Common request models

### Signup request

Used by `POST /api/v1/auth/signup`.

```ts
type SignUpRequest = {
  email: string;
  password: string;
  full_name?: string | null;
};
```

Validation:

- `email` must be a valid email address.
- `password` must be 8 to 128 characters.
- `full_name` is optional.

### Signin request

Used by `POST /api/v1/auth/signin` and `POST /api/v1/auth/login`.

```ts
type SignInRequest = {
  email: string;
  password: string;
};
```

### Refresh request

Used by `POST /api/v1/auth/refresh`. The field is optional: cookie clients can
omit the body entirely and rely on the `refreshToken` cookie; an explicit
value in the body takes precedence over the cookie when both are present.

```ts
type RefreshTokenRequest = {
  refresh_token?: string | null;
};
```

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

## Auth responses

Token response:

```ts
type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};
```

Current user response:

```ts
type UserResponse = {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
};
```

Logout response:

```ts
type LogoutResponse = {
  detail: string;
};
```

## Signup

```http
POST /api/v1/auth/signup
Content-Type: application/json
```

```json
{
  "email": "ada@example.com",
  "password": "valid-password",
  "full_name": "Ada Lovelace"
}
```

Purpose:

- Creates a new active user.
- Lowercases the email before storing it.
- Sets `accessToken` and `refreshToken` cookies.
- Returns access and refresh tokens immediately after signup (dual-mode; see
  "Dual-mode migration" above).

Success:

- `201 Created`
- Body: `TokenResponse`

Errors:

- `409` with `{"detail":"Email is already registered"}` when the email already
  exists.
- `422` for validation errors such as invalid email or too-short password.

## Signin and login

```http
POST /api/v1/auth/signin
Content-Type: application/json
```

`POST /api/v1/auth/login` is an alias with the same request and response
contract.

```json
{
  "email": "ada@example.com",
  "password": "valid-password"
}
```

Purpose:

- Verifies email and password.
- Rejects inactive users.
- Sets `accessToken` and `refreshToken` cookies.
- Returns access and refresh tokens (dual-mode; see "Dual-mode migration"
  above).

Success:

- `200 OK`
- Body: `TokenResponse`

Errors:

- `401` with `{"detail":"Could not validate credentials"}` for missing user or
  bad password.
- `403` with `{"detail":"Inactive user"}` for inactive users.
- `422` for validation errors.

## Refresh tokens

Cookie client (browser) — no request body is needed; the browser sends the
`refreshToken` cookie:

```http
POST /api/v1/auth/refresh
```

Bearer-style client — explicit body:

```http
POST /api/v1/auth/refresh
Content-Type: application/json
```

```json
{
  "refresh_token": "<refresh_token>"
}
```

Purpose:

- Resolves the refresh token from the body if provided, otherwise from the
  `refreshToken` cookie.
- Validates that it decodes as a refresh token.
- Verifies the user still exists and is active.
- Issues a fresh access token and refresh token, and sets new
  `accessToken`/`refreshToken` cookies.

Success:

- `200 OK`
- Body: `TokenResponse`

Errors:

- `401` with `{"detail":"Could not validate credentials"}` when the token is
  invalid, expired, the wrong token type, or belongs to an inactive/missing
  user — this also covers the case where no token was supplied at all (no
  body value and no cookie).
- `422` for validation errors.

Frontend behavior:

- Cookie clients: call with no body; ignore `access_token`/`refresh_token` in
  the response body (cookies are already
  updated) unless still in the dual-mode migration window.
- Bearer clients: keep sending `refresh_token` in the body as before; store
  the new `refresh_token` from the response and only send it to this
  endpoint.
- Do not send an access token to `/auth/refresh`; the backend requires a
  refresh token type.

## Logout

```http
POST /api/v1/auth/logout
```

Purpose:

- Clears `accessToken` and `refreshToken` cookies
  (`Set-Cookie` with `Max-Age=0`, matching each cookie's original `Path`).
- Does **not** revoke the token server-side — there is no token
  blacklist/allowlist table in this codebase yet. A bearer token used outside
  the cookie flow remains valid until it naturally expires.

Success:

- `200 OK`
- Body: `LogoutResponse` (`{"detail": "Logged out"}`)

## Current user

```http
GET /api/v1/auth/me
Authorization: Bearer <access_token>
```

Purpose:

- Returns the authenticated active user profile.
- Useful for app bootstrapping and "am I signed in?" checks.

Success:

- `200 OK`
- Body: `UserResponse`

Errors:

- `401` with `WWW-Authenticate: Bearer` when no valid access token is supplied.

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
Authorization: Bearer <access_token>
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
Authorization: Bearer <access_token>
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
Authorization: Bearer <access_token>
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
Authorization: Bearer <access_token>
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
Authorization: Bearer <access_token>
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

## Session list

```http
GET /api/v1/swarm/sessions?limit=100&offset=0
Authorization: Bearer <access_token>
```

Purpose:

- Lists only sessions owned by the authenticated user.
- Returns lightweight project summaries rather than full architecture and
  artifact payloads.
- Orders sessions newest first.
- Supports offset pagination with `limit` from `1` to `100` and `offset` at
  least `0`.
- Does not expose sessions created before ownership tracking was introduced.

Success response:

```ts
type SwarmSessionListResponse = {
  sessions: SwarmSessionSummary[];
};

type SwarmSessionSummary = {
  thread_id: string;
  requirement: string;
  revision_number: number;
  status: string;
  complexity: number | null;
  diagram_count: number | null;
  doc_count: number | null;
  created_at: string | null;
  completed_at: string | null;
};
```

## Persisted session

```http
GET /api/v1/swarm/sessions/{thread_id}
Authorization: Bearer <access_token>
```

Purpose:

- Reads durable app-table data for a completed, running, or failed swarm
  session.
- Returns final graph-state projection, reviewer debate logs, and persisted
  artifact metadata.
- This is the preferred final read after streaming completes.
- Returns `404` when the session does not exist or belongs to another user.

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
Authorization: Bearer <access_token>
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
Authorization: Bearer <access_token>
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
async function signUp(input: SignUpRequest): Promise<TokenResponse>;
async function signIn(input: SignInRequest): Promise<TokenResponse>;
async function logIn(input: SignInRequest): Promise<TokenResponse>;
async function refreshAuth(input?: RefreshTokenRequest): Promise<TokenResponse>;
async function logout(): Promise<LogoutResponse>;
async function getCurrentUser(): Promise<UserResponse>;
async function startSwarmRun(input: SwarmRunRequest): Promise<SwarmRunResponse>;
async function resumeSwarmRun(input: SwarmResumeRequest): Promise<SwarmRunResponse>;
async function getSwarmState(threadId: string): Promise<SwarmCheckpointResponse>;
async function listSwarmSessions(
  options?: { limit?: number; offset?: number },
): Promise<SwarmSessionListResponse>;
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

- Prefer cookie-based auth for browser clients: send requests with
  `credentials: "include"` (`fetch`) / `withCredentials: true` (`axios`)
  instead of manually attaching `Authorization: Bearer <access_token>`. The
  bearer header still works (and is required for non-browser clients), but is
  optional/deprecated for the frontend now that cookies are set automatically.
- On `401`, call `/api/v1/auth/refresh` (cookie clients: no body needed) then
  retry the original request once.
- Native `EventSource` cannot send a JSON `POST` body. Use `fetch` streaming,
  `@microsoft/fetch-event-source`, or another SSE client that supports POST
  bodies and custom auth headers.
- The stream response headers include `Cache-Control: no-cache` and
  `X-Accel-Buffering: no`.
- Treat non-2xx JSON responses as API errors. For stream endpoints, also handle
  `event: error`.
- The backend requires auth for all registered swarm routes today.
