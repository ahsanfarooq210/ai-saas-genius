## API Gateway

### Responsibilities

The API Gateway is the sole HTTP entry point for all web and mobile client traffic. It is an Express.js application that terminates TLS, validates incoming requests, enforces authentication, and routes traffic to the appropriate downstream service. It does not contain social-media domain logic.

Specific responsibilities include:

- **Request termination and validation**: Accept HTTPS traffic, enforce `Content-Type` and `Accept` headers, and validate JSON bodies up to a strict size limit.
- **Authentication gating**: Verify `Authorization: Bearer <JWT>` signatures using public keys from `auth_service` before allowing access to user, content, scheduler, or media endpoints.
- **Routing**: Proxy or dispatch requests to `auth_service`, `user_service`, `content_service`, `scheduler_service`, and `media_service` based on URL path.
- **Media upload streaming**: Accept `multipart/form-data` photo and video uploads and stream them directly to `media_service` without buffering the full blob in gateway memory.
- **Rate limiting**: Enforce per-user request quotas on posting and scheduling endpoints to prevent downstream abuse.
- **Error normalization**: Convert downstream HTTP errors, timeouts, and connection failures into standardized client responses (RFC 7807 Problem Details).
- **Observability**: Inject `x-request-id` headers into all internal calls and emit structured access logs for request tracing.

### APIs and Interfaces

**Public HTTP Surface**

| Route Group | Methods | Downstream Target |
|-------------|---------|-------------------|
| `/api/v1/auth/*` | `POST`, `GET` | `auth_service` |
| `/api/v1/users/me*` | `GET`, `PATCH`, `DELETE` | `user_service` |
| `/api/v1/content/drafts*` | `POST`, `GET`, `PATCH`, `DELETE` | `content_service` |
| `/api/v1/schedule/jobs*` | `POST`, `GET`, `DELETE` | `scheduler_service` |
| `/api/v1/media/upload` | `POST` | `media_service` |
| `/api/v1/media/:mediaId` | `GET` | `media_service` |

**Internal Service Client Interface**

- Axios-based HTTP clients with environment-derived base URLs (`AUTH_SERVICE_URL`, `USER_SERVICE_URL`, etc.).
- Each client uses a shared `http.Agent` with `keepAlive: true` to reuse TCP connections to downstream services.
- Request interceptors attach `x-request-id` and the authenticated user's JWT for downstream identity propagation.

**Middleware Stack**

- `helmet` for security headers.
- `cors` with a strict origin whitelist matching the web dashboard and mobile app domains.
- `express.json()` with a 10 KB limit for scheduler preferences and a 100 KB limit for content draft payloads.
- `multer` or proxy stream parser **only** on `/api/v1/media/upload` to handle multipart uploads without disk buffering.
- Custom JWT verification middleware that validates the `Bearer` token signature and expiry.
- `express-rate-limit` middleware on write endpoints (`POST`, `PATCH`, `DELETE`).

**Health and Readiness**

- `GET /health` — Returns 200 if the gateway process is alive.
- `GET /health/ready` — Returns 200 only if TCP health checks to `auth_service` and `user_service` succeed within 3 seconds.

### Data Ownership

The API Gateway owns **no persistent business data** in MongoDB or any other store. It is fully stateless with respect to domain models.

Ephemeral runtime state includes:

- Active HTTP request/response streams in the Node.js event loop.
- In-memory rate-limit counters when running without a Redis-backed store.
- Runtime configuration (downstream service URLs, JWT public key, CORS whitelist) injected via environment variables at startup.

### Failure Modes

- **Downstream service timeout**: If `content_service` or `scheduler_service` fails to respond within the configured timeout, the gateway must return `504 Gateway Timeout` rather than leave the client hanging. Unhandled timeouts block the event loop and exhaust Node.js connection pools.
- **Memory exhaustion on media upload**: Buffering a large video upload into heap memory causes an uncaught OOM crash. The gateway must stream `multipart/form-data` directly to `media_service` using HTTP proxy piping.
- **Auth service outage**: If `auth_service` is unreachable and the gateway relies on it for token introspection, all authenticated endpoints return `503 Service Unavailable`. Mitigation: perform local JWT signature verification using a cached public key so the gateway does not depend on `auth_service` at request time.
- **Scheduler rejection**: If `scheduler_service` rejects a job due to an invalid cron expression or missing draft reference, the gateway must propagate the downstream `400 Bad Request` and error message verbatim to the client.
- **Rate-limit false positives**: Sudden legitimate traffic bursts (e.g., bulk schedule updates) trigger `429 Too Many Requests`. Clients must implement exponential backoff; the gateway must return a `Retry-After` header.
- **CORS misconfiguration**: An omitted mobile app domain in the CORS whitelist causes preflight failures and blocked requests from legitimate clients.
- **Circuit saturation**: Repeated slow responses from `media_service` during thumbnail generation can backlog the gateway's connection pool. A circuit breaker must open after a defined failure threshold.

### Scaling Considerations

- **Stateless horizontal scaling**: Deploy multiple container replicas behind a Layer-7 load balancer. Do not store session state in memory; rely on the JWT for client identity.
- **Connection pooling**: Configure each downstream Axios client with `maxSockets: 50` and `keepAlive: true` to minimize TCP handshake overhead under high concurrency.
- **Streaming uploads**: Use `http-proxy-middleware` or Node.js `pipeline()` to proxy media uploads from client to `media_service`. Never use in-memory buffers for video payloads.
- **Circuit breakers**: Implement per-service circuit breakers (e.g., using `opossum`). Open the circuit to `auth_service` after 5 consecutive timeouts or 50% failure rate over a 30-second window, returning `503` immediately without attempting the connection.
- **Differentiated timeouts**:
  - `auth_service` / `user_service`: 5 seconds
  - `content_service` / `scheduler_service`: 10 seconds
  - `media_service` uploads: 60 seconds
- **Payload guards**: Keep JSON payload limits strict. Reject oversized scheduler preference payloads with `413 Payload Too Large` before they reach downstream services.
- **Health-based load balancing**: The `/health/ready` endpoint must fail if critical downstream services (`auth_service`, `user_service`) are unreachable so the load balancer stops routing new traffic to that replica.

## Related Diagrams

No paired component diagram is provided for this document.