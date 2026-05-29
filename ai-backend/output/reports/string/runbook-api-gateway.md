# API Gateway Runbook

## Responsibilities

The API Gateway is an Express.js web server that serves as the single ingress point for all external HTTP traffic into the social media automation platform. Its responsibilities are strictly limited to request handling, routing, and cross-cutting middleware; it does not execute business logic or persist domain data.

- **Request Ingress & TLS Termination**: Accepts all inbound HTTPS traffic from web and mobile clients.
- **Routing**: Dispatches requests to downstream services based on URL path and method:
  - `/v1/auth/*` → `authService`
  - `/v1/accounts/*` → `accountService`
  - `/v1/preferences/*` → `preferenceService`
  - `/v1/media/*` → `mediaStorage`
  - `/v1/jobs/*` → `jobScheduler`
- **Authentication at the Edge**: Validates `Authorization: Bearer <JWT>` tokens on protected routes before forwarding requests. Rejects expired or malformed tokens with `401 Unauthorized` without hitting downstream services.
- **Request Validation**: Enforces JSON schema and `multipart/form-data` constraints (e.g., max 10 KB JSON payloads for preferences, max 50 MB file uploads for media).
- **Middleware Stack**: Applies Helmet security headers, CORS policies for the frontend origin, request ID injection for distributed tracing, and unified error serialization.
- **Rate Limiting & Abuse Prevention**: Applies per-IP and per-user rate limits (e.g., 100 requests/minute for API calls, 20 uploads/hour per user).
- **File Upload Handling**: Streams photo and video uploads through to `mediaStorage` without buffering entire files in the Node.js process heap.
- **Response Aggregation**: Returns downstream success/error responses directly to the client with appropriate HTTP status code mapping.

## APIs and Interfaces

### External REST Interface

All endpoints are versioned under `/v1`.

**Auth Routes** (`authService`)
- `POST /v1/auth/register` – Create a new user account.
- `POST /v1/auth/login` – Authenticate and receive a JWT.
- `POST /v1/auth/refresh` – Rotate an access token using a refresh token.

**Account Routes** (`accountService`)
- `GET /v1/accounts` – List connected social media platforms for the authenticated user.
- `POST /v1/accounts/:platform/connect` – Initiate or complete OAuth flow for a target platform (e.g., Twitter, Instagram, TikTok).
- `DELETE /v1/accounts/:accountId` – Revoke and disconnect a linked platform.

**Preference Routes** (`preferenceService`)
- `GET /v1/preferences` – Retrieve posting schedules, captions, hashtags, target platforms, media-type rules, and publishing times.
- `PUT /v1/preferences` – Update user posting configuration.

**Media Routes** (`mediaStorage`)
- `POST /v1/media/upload` – Upload a photo or video. Accepts `multipart/form-data`.
- `GET /v1/media/:mediaId` – Retrieve metadata or a presigned redirect for a stored asset.

**Job Routes** (`jobScheduler`)
- `POST /v1/jobs/schedule` – Queue a background publishing job. Body includes `mediaIds`, `accountIds`, `scheduledAt`, and an optional preferences snapshot.
- `GET /v1/jobs` – List pending and completed Agenda.js jobs for the user.
- `DELETE /v1/jobs/:jobId` – Cancel a queued or scheduled job before execution.

### Internal Service Interface

The Gateway communicates with downstream services over HTTP/1.1 using a shared `http.Agent` with keep-alive enabled.

- **authService**: `GET /internal/auth/verify` (token introspection), `POST /internal/auth/logout`.
- **accountService**: `GET /internal/accounts?userId={id}`, `POST /internal/accounts`, `DELETE /internal/accounts/{accountId}`.
- **preferenceService**: `GET /internal/preferences/{userId}`, `PUT /internal/preferences/{userId}`.
- **mediaStorage**: `POST /internal/media` (streaming upload), `GET /internal/media/{mediaId}`.
- **jobScheduler**: `POST /internal/jobs`, `GET /internal/jobs?userId={id}`, `DELETE /internal/jobs/{jobId}`.

All internal requests carry a `X-Request-ID` header and a service-to-service bearer token for authentication.

## Data Ownership

The API Gateway is **stateless** and owns **no persistent domain data**.

- **No database connections**: It does not read from or write to MongoDB.
- **Ephemeral request context only**: Each request may hold transient objects such as decoded JWT claims (`req.user`), correlation IDs, and parsed multipart streams. These exist only for the lifetime of the HTTP request/response cycle.
- **No session state**: User sessions are represented entirely by the JWT held by the client.

## Failure Modes

| Failure | Impact | Detection / Mitigation |
|---|---|---|
| **Downstream service timeout** | Client receives `504 Gateway Timeout` if `authService`, `jobScheduler`, or another dependency exceeds the configured timeout (e.g., 5 seconds). | Monitor p99 latency per route. Implement circuit breaker logic to fast-fail repeated timeouts. |
| **JWT validation failure** | All protected routes return `401` or `403`. This can occur due to clock skew, revoked tokens, or malformed signatures. | Log token validation errors with request IDs. Ensure the gateway has access to the authService public key or JWKS endpoint. |
| **Media upload memory exhaustion** | Concurrent large video uploads can crash the Node.js process if the gateway buffers files instead of streaming. | Enforce streaming via `busboy` or `multer` with disk/memory limits. Reject uploads exceeding 50 MB with `413 Payload Too Large`. |
| **Rate limit breached** | Legitimate users or abusive clients hit `429 Too Many Requests`. | Return `Retry-After` headers. Use in-memory rate limiting for single-instance deployments; migrate to a Redis-backed store when scaling horizontally. |
| **JobScheduler backpressure** | Scheduling requests queue up in the gateway event loop if `jobScheduler` is slow to acknowledge Agenda.js job creation. | Set aggressive HTTP timeouts for the scheduler endpoint and surface `503 Service Unavailable` if latency degrades. |
| **CORS misconfiguration** | Frontend requests blocked by browser preflight checks. | Strictly whitelist the production frontend origin; avoid wildcard `*` in `Access-Control-Allow-Origin` for authenticated endpoints. |
| **Uncaught exception in middleware** | Unhandled errors in Express can terminate the Node.js process, dropping all in-flight requests. | Use a centralized async error handler and process-level `uncaughtException` / `unhandledRejection` handlers that trigger graceful shutdown. |

## Scaling Considerations

- **Horizontal Scaling**: Deploy multiple stateless instances behind a layer-7 load balancer (e.g., NGINX, AWS ALB). Because the gateway holds no local session state, any instance can handle any request.
- **CPU & Event Loop**: Node.js is single-threaded. CPU-intensive tasks such as large JSON schema validation or regex matching on captions can block the event loop. Offload heavy work to worker threads or downstream services.
- **Connection Pooling**: Reuse TCP connections to downstream services via `http.Agent` keep-alive to avoid port exhaustion and TCP handshake overhead under high concurrency.
- **Media Upload Offloading**: For large video files, avoid proxying bytes through the gateway. Instead, return presigned upload URLs directly from `mediaStorage` so the client uploads to object storage without traversing Express.
- **Request Body Limits**: Apply `express.json({ limit: '10kb' })` globally. Override with larger limits only on specific routes that require it (e.g., bulk preference imports).
- **Memory Profiling**: Monitor heap usage during peak upload windows. If memory grows with concurrency, verify that streams are being piped and that backpressure is handled.
- **Graceful Shutdown**: On SIGTERM, stop accepting new connections, wait for in-flight requests to complete (up to a threshold), and then exit. This prevents dropped requests during rolling deployments.

## Related Diagrams

- `diagrams/string/iter1_overview.mmd`