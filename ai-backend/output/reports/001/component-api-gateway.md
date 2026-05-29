## Component: API Gateway

### Overview
The API Gateway is the sole external ingress point for the social media automation platform. It is an Express.js application that exposes REST endpoints to web and mobile clients, terminates TLS, enforces authentication, validates request payloads, and routes traffic to downstream domain services. It is intentionally stateless and does not contain business logic for scheduling, media processing, or publishing.

---

### Responsibilities

- **Request Routing & Endpoint Exposure**
  - Exposes versioned REST routes (`/api/v1/*`) for authentication, user settings, scheduled job management, and media handling.
  - Proxies or dispatches requests to the appropriate downstream service (`auth_service`, `user_service`, `job_scheduler`, `media_processor`, `platform_publisher`).

- **Authentication & Authorization Middleware**
  - Validates JWT bearer tokens on protected routes using secrets managed by `auth_service`.
  - Extracts the user context (`userId`, `roles`) from the token and injects it into downstream request headers (`x-user-id`, `x-user-role`).
  - Rejects expired or malformed tokens with `401 Unauthorized` before any downstream traffic is generated.

- **Request Validation**
  - Enforces strict payload validation (e.g., via Zod or Joi) for complex user inputs such as `postingFrequency`, `publishingTimes`, `targetPlatforms`, `hashtags`, and `caption` templates.
  - Validates `scheduledAt` timestamps and cron-like recurrence rules before forwarding job-creation requests to `job_scheduler`.

- **Rate Limiting & Abuse Prevention**
  - Applies per-user and per-IP rate limits to sensitive endpoints (login, job creation, media upload) to prevent brute-force attacks and scheduler overload.
  - Returns `429 Too Many Requests` when limits are breached.

- **Media Upload Ingress**
  - Accepts multipart/form-data uploads for photos and videos via streaming middleware (e.g., Multer with disk storage).
  - Forwards streams to `media_processor` or `media_storage` without buffering entire files in memory.

- **Response Aggregation & Normalization**
  - Aggregates data from multiple services when necessary (e.g., enriching a user profile response with active platform connections from `user_service` and pending job counts from `job_scheduler`).
  - Maps internal service errors to standard HTTP status codes and uniform JSON error schemas.

- **Observability & Tracing**
  - Generates and attaches `x-request-id` correlation IDs to all internal service calls for distributed tracing across `job_scheduler`, `media_processor`, and `platform_publisher`.
  - Logs request latency, status codes, and downstream routing decisions.

---

### APIs / Interfaces

#### External Client-Facing REST Endpoints

**Authentication** (`/api/v1/auth`)
```http
POST   /register
POST   /login
POST   /logout
POST   /refresh
GET    /oauth/:platform/callback    # OAuth2 callback handler for social platforms
```

**User & Preferences** (`/api/v1/users`)
```http
GET    /me
PATCH  /me/preferences              # { targetPlatforms, postingFrequency, mediaType,
                                   #   captions, hashtags, publishingTimes, timezone }
GET    /me/platforms
POST   /me/platforms/:platform      # Connect/configure a social account
DELETE /me/platforms/:platform
```

**Job Management** (`/api/v1/jobs`)
```http
POST   /                            # Create Agenda.js background job
GET    /?status=&page=&limit=       # List user's scheduled/completed jobs
GET    /:jobId                      # Get job detail and execution logs
DELETE /:jobId                      # Cancel a pending job in Agenda.js
POST   /:jobId/trigger              # Immediate execution via job_scheduler
```

**Media** (`/api/v1/media`)
```http
POST   /upload                      # Multipart upload forwarded to media_processor
GET    /:mediaId/status             # Processing/publishing status
```

**Manual Publishing** (`/api/v1/publish`)
```http
POST   /now                         # Bypass scheduler; invoke platform_publisher immediately
```

**Health & Operations**
```http
GET    /health                      # Gateway liveness + downstream connectivity probes
GET    /metrics                     # Prometheus-compatible request/response metrics
```

#### Internal Service Interfaces

- **Synchronous HTTP Dispatch**: Uses a shared HTTP client (Node.js `fetch` or Axios) with persistent `http.Agent` keep-alive pools to communicate with downstream services over the internal network.
- **Context Propagation**: Forwards `x-request-id`, `x-user-id`, and validated JWT claims in internal request headers so that `user_service` and `job_scheduler` remain decoupled from token parsing.
- **File Stream Proxying**: For media uploads, streams the multipart request directly to `media_processor` or returns a presigned URL to the client to upload directly to `media_storage`, bypassing the Gateway when possible.

---

### Data Ownership

The API Gateway is **stateless** and does **not** own any persistent data in MongoDB or any other primary store.

| Data | Ownership | Notes |
|------|-----------|-------|
| Users, preferences, tokens | None | Owned by `auth_service`, `user_service`, `token_store` |
| Jobs, posts, analytics | None | Owned by `job_scheduler`, `platform_publisher`, `analytics_collector` |
| Media blobs | None | Owned by `media_storage` |
| Route configuration | Owned | Express route tables, CORS policies, upstream service base URLs |
| Rate-limit counters | Ephemeral | Per-instance memory (resets on restart/deploy) |
| Request logs | Ephemeral | Stdout/stderr or log drain; not a source of truth |

---

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Downstream `auth_service` unavailable** | Login, registration, and OAuth callbacks fail with `503 Service Unavailable`. | Circuit breaker: open after 5 consecutive timeouts; return `503` immediately without queuing additional traffic. |
| **JWT validation mismatch** | Client receives `401 Unauthorized`. Edge case: clock skew between Gateway and `auth_service`. | Allow a small leeway window (e.g., 60s) on `nbf`/`exp` claims; reject with clear `WWW-Authenticate` header. |
| **`job_scheduler` MongoDB write conflict** | Duplicate job name or overlapping schedule returns `409 Conflict`. | Gateway surfaces `409` to client; requires user to modify unique job name or schedule. |
| **Large file upload exhaustion** | Video uploads (>50MB) risk crashing the Node.js process if buffered in memory. | Enforce streaming via Multer with disk temp buffers; reject with `413 Payload Too Large` before stream processing if `Content-Length` exceeds limit. |
| **`media_processor` timeout during upload** | Client connection hangs, Gateway memory usage spikes. | Enforce a 60s hard timeout on media routes; abort stream and return `504 Gateway Timeout`. |
| **`platform_publisher` latency on manual publish** | Synchronous `POST /publish/now` call stalls because social platform APIs are slow. | Gateway timeout set to 15s; if exceeded, return `202 Accepted` with a polling URL so the client can query `job_scheduler` for completion status. |
| **Rate limit state loss on redeploy** | In-memory rate counters reset, allowing temporary quota busting. | Pin users to instances via IP-hash load balancing or document the limitation until a shared Redis-backed store is introduced. |
| **Invalid cron/timezone payload** | `job_scheduler` or Agenda.js rejects the job definition after creation. | Gateway validates `publishingTimes` against platform-supported timezones and valid cron syntax before forwarding. |

---

### Scaling Considerations

- **Horizontal Scaling**: The Gateway scales horizontally behind a load balancer (e.g., Nginx, AWS ALB). Because it is stateless, no sticky sessions or shared memory are required.
- **Upload Offloading**: To avoid becoming a network bottleneck for photo/video traffic, the Gateway should generate presigned upload URLs for `media_storage` where feasible, keeping large binary streams off the Express server.
- **Connection Reuse**: Configure `http.Agent` with `keepAlive: true` for downstream service connections to minimize TCP handshake overhead to `user_service` and `job_scheduler`.
- **Granular Timeouts**:
  - `auth_service`: 5 seconds
  - `user_service`: 5 seconds
  - `job_scheduler`: 10 seconds (Agenda.js writes to MongoDB can experience lock contention)
  - `media_processor`: 60 seconds (upload and initial processing)
  - `platform_publisher`: 15 seconds (external social API latency)
- **Circuit Breakers**: Implement per-destination circuit breakers. If `platform_publisher` fails repeatedly, the breaker opens to prevent thread/event-loop saturation in the Gateway and cascading latency.
- **Response Caching**: Cache read-heavy, low-volatility responses (e.g., platform configuration enums, user connection status) for short TTLs (5–10 seconds) to reduce redundant `user_service` calls.
- **Memory Management**: Avoid buffering response bodies from `job_scheduler` or `media_processor`; stream responses back to the client where possible to keep the Node.js heap stable under concurrent load.

---

## Related Diagrams

No paired Mermaid diagram is provided for this component.