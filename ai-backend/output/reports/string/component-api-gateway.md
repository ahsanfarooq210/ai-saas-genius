# API Gateway

## Overview
The API Gateway is an Express.js web server that serves as the single entry point for all client traffic to the social media automation platform. It terminates incoming HTTP requests, applies cross-cutting middleware concerns, and routes authenticated traffic to the appropriate downstream services: `authService`, `accountService`, `preferenceService`, `mediaStorage`, and `jobScheduler`. The gateway remains stateless and does not implement business logic; it delegates all domain operations to these internal services over HTTP.

---

## Responsibilities

- **Request Routing** — Route incoming requests to downstream services based on path and method:
  - `/api/v1/auth/*` → `authService`
  - `/api/v1/accounts/*` → `accountService`
  - `/api/v1/preferences/*` → `preferenceService`
  - `/api/v1/media/*` → `mediaStorage`
  - `/api/v1/jobs/*` → `jobScheduler`

- **Authentication Enforcement** — Validate `Authorization: Bearer <JWT>` headers on protected routes. Reject unauthenticated or expired requests with `401 Unauthorized` before forwarding.

- **Request Validation & Sanitization** — Enforce JSON schema validation, `Content-Type` checks, and payload size limits at the edge (e.g., maximum upload size for videos, required fields for scheduling requests).

- **Media Upload Handling** — Accept `multipart/form-data` uploads for photos and videos. Stream request payloads to `mediaStorage` rather than buffering entire files in memory.

- **Rate Limiting & Abuse Prevention** — Apply per-IP and per-user rate limits to protect `jobScheduler` and `mediaStorage` from overload or brute-force attacks.

- **CORS & Security Headers** — Restrict cross-origin requests to known frontend domains and apply security headers (e.g., via Helmet.js).

- **Observability** — Generate structured access logs with correlation IDs (`X-Request-ID`) to trace requests across the distributed backend.

- **Error Normalization** — Catch downstream HTTP errors and map them to a uniform client-facing error schema with consistent status codes and machine-readable error codes.

---

## APIs / Interfaces

### Public REST Endpoints

| Method | Path | Downstream Target | Description |
|--------|------|-------------------|-------------|
| `POST` | `/api/v1/auth/register` | `authService` | Create a new user account |
| `POST` | `/api/v1/auth/login` | `authService` | Authenticate and receive JWT |
| `POST` | `/api/v1/auth/refresh` | `authService` | Refresh access token |
| `GET` | `/api/v1/accounts` | `accountService` | List connected social accounts |
| `POST` | `/api/v1/accounts/connect/:platform` | `accountService` | Initiate OAuth connection flow |
| `DELETE` | `/api/v1/accounts/:accountId` | `accountService` | Revoke and remove account link |
| `GET` | `/api/v1/preferences` | `preferenceService` | Fetch posting schedules, captions, hashtags |
| `PUT` | `/api/v1/preferences` | `preferenceService` | Update posting rules and target platforms |
| `POST` | `/api/v1/media/upload` | `mediaStorage` | Upload photo or video asset |
| `GET` | `/api/v1/media/:mediaId` | `mediaStorage` | Retrieve uploaded media metadata/URL |
| `POST` | `/api/v1/jobs` | `jobScheduler` | Schedule a new publishing job |
| `GET` | `/api/v1/jobs` | `jobScheduler` | List queued and historical jobs |
| `DELETE` | `/api/v1/jobs/:jobId` | `jobScheduler` | Cancel a pending job |
| `GET` | `/health` | Internal | Liveness and readiness probe endpoint |

### Internal Service Interfaces

The gateway communicates with downstream services via HTTP/1.1 (using an HTTP client such as Axios or Node.js `fetch` with `http.Agent` keep-alive enabled). All internal requests:
- Propagate the original `Authorization` header containing the JWT.
- Attach an `X-Request-ID` correlation ID for distributed tracing.
- Use JSON request/response bodies unless proxying a binary media stream.
- Expect downstream services to return standard HTTP status codes (`2xx`, `4xx`, `5xx`) with JSON error details.

---

## Data Ownership

The API Gateway is **stateless** and owns **no persistent business data**. It does not interact directly with MongoDB. Transient data held during request processing includes:
- In-flight HTTP request/response streams.
- JWT claims extracted from the `Authorization` header for the duration of the request.
- Ephemeral middleware context (correlation IDs, parsed cookies).

Any rate-limiting counters or session state must reside in external storage (e.g., Redis) when scaling horizontally.

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Downstream service timeout** | Gateway thread/Event Loop blocked, cascading latency | Enforce aggressive timeouts (e.g., 5–10 s) per route; return `504 Gateway Timeout`. |
| **Media upload memory exhaustion** | Node.js process crash (`OOM`) due to large video buffers | Stream `multipart` uploads directly to `mediaStorage` using backpressure; enforce `maxFileSize` limits at the reverse proxy and application level. |
| **JWT secret mismatch or clock skew** | Mass `401` rejections for valid users | Use shared JWT secret via environment config; tolerate small `maxAge` leeway; sync NTP on hosts. |
| **Unbounded downstream connections** | Exhaustion of OS file descriptors or HTTP agent pool | Configure `maxSockets` on internal HTTP agents; implement connection pooling. |
| **Middleware exception** | Complete process crash (single-threaded Node.js) | Wrap all async middleware in an Express error-handling wrapper; use a process manager (PM2/Docker) for fast restart. |
| **Rate limiter state divergence** | Inconsistent throttling across replicas | Externalize rate-limit storage to Redis rather than in-memory maps. |
| **Client disconnect during upload** | Orphaned temporary streams or partial files in `mediaStorage` | Handle `req.on('close')` events to abort upstream streams and trigger cleanup. |

---

## Scaling Considerations

- **Horizontal Replication** — Deploy multiple Node.js instances behind a load balancer (e.g., NGINX, AWS ALB). Because JWT validation is stateless, no sticky sessions are required.
- **Rate Limiting at Scale** — Replace in-memory rate limiters with a Redis-backed store so counters are shared across all gateway replicas.
- **Keep-Alive for Internal Calls** — Reuse TCP connections to `authService`, `accountService`, and other downstream services via HTTP agents with `keepAlive: true` to reduce latency and port exhaustion under high concurrency.
- **Upload Offload** — For large-scale media ingestion, consider generating presigned upload URLs via `mediaStorage` so clients upload directly to object storage, bypassing the gateway entirely.
- **Graceful Shutdown** — On SIGTERM, stop accepting new connections (`server.close()`), drain active requests, and only then exit. This prevents abrupt disconnects during rolling deployments.
- **Event Loop Protection** — Avoid CPU-intensive middleware (e.g., complex regex routing, large JSON parsing without limits). Offload heavy validation to downstream services or worker threads.

---

## Related Diagrams

No paired Mermaid diagram was provided for this component.