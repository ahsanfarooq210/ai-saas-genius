# API Gateway

## Responsibilities

The API Gateway is the single public entry point for the social media automation platform. Implemented as an Express.js application, it exposes a unified REST API to web and mobile clients and routes requests to the appropriate downstream services. Its core responsibilities include:

- **Request Routing**: Directs authenticated and public traffic to `auth_service`, `user_service`, `scheduler_service`, `media_service`, `post_service`, and `platform_connector` via internal HTTP calls.
- **Authentication Enforcement**: Intercepts all protected routes to validate `Authorization: Bearer <JWT>` headers. Token verification is performed using asymmetric public keys fetched from `auth_service`; the gateway rejects expired, malformed, or blacklisted tokens before traffic reaches downstream services.
- **Request Validation**: Enforces JSON body schemas (via a validator such as AJV) for all `POST`, `PUT`, and `PATCH` payloads. Rejects requests with missing required fields (e.g., missing `platform` in posting preferences) or invalid data types before proxying.
- **Media Upload Handling**: Accepts `multipart/form-data` streams for photo and video uploads on `/api/v1/media/upload`. Streams chunks to `media_service` while enforcing a maximum file size limit (e.g., 500 MB for video) and MIME-type allowlists (`image/jpeg`, `image/png`, `video/mp4`).
- **Response Aggregation & Normalization**: Combines data from multiple services when necessary (e.g., enriching a post details response with signed media URLs from `media_service` and platform publish status from `platform_connector`) and returns a standardized client payload.
- **Cross-Cutting Concerns**: Applies CORS policies, security headers (Helmet), compression, and request ID propagation via `X-Request-ID` headers for distributed tracing across services.
- **Health & Readiness**: Exposes `/health` (process liveness) and `/ready` (downstream connectivity checks) endpoints for load balancer and orchestrator health probes.

## API Surface and Routing

The gateway mounts versioned Express routers (`/api/v1`) and maps endpoints to downstream services. All routes below expect `Content-Type: application/json` unless specified otherwise.

### Authentication & OAuth
| Method | Route | Downstream | Description |
|--------|-------|------------|-------------|
| `POST` | `/api/v1/auth/register` | `auth_service` | Create new user account |
| `POST` | `/api/v1/auth/login` | `auth_service` | Authenticate and receive JWT pair |
| `POST` | `/api/v1/auth/refresh` | `auth_service` | Rotate access token using refresh token |
| `POST` | `/api/v1/auth/logout` | `auth_service` | Invalidate active session/tokens |
| `GET` | `/api/v1/auth/oauth/:platform/connect` | `auth_service` | Initiate OAuth flow for a social platform |
| `GET` | `/api/v1/auth/oauth/:platform/callback` | `auth_service` | OAuth callback handler (state verification) |

### User Profile & Preferences
| Method | Route | Downstream | Description |
|--------|-------|------------|-------------|
| `GET` | `/api/v1/users/me` | `user_service` | Fetch current user profile |
| `PUT` | `/api/v1/users/me` | `user_service` | Update profile fields |
| `GET` | `/api/v1/users/me/preferences` | `user_service` | Retrieve posting settings (frequency, times, captions, hashtags) |
| `PUT` | `/api/v1/users/me/preferences` | `user_service` | Update posting preferences and account-specific configurations |
| `GET` | `/api/v1/users/me/accounts` | `user_service` | List connected social media accounts |

### Media Management
| Method | Route | Downstream | Description |
|--------|-------|------------|-------------|
| `POST` | `/api/v1/media/upload` | `media_service` | Upload photo/video (`multipart/form-data`) |
| `GET` | `/api/v1/media/:mediaId` | `media_service` | Retrieve media metadata and processing status |
| `DELETE` | `/api/v1/media/:mediaId` | `media_service` | Soft-delete uploaded media |

### Post Composition
| Method | Route | Downstream | Description |
|--------|-------|------------|-------------|
| `GET` | `/api/v1/posts` | `post_service` | List posts with pagination |
| `POST` | `/api/v1/posts` | `post_service` | Create a new post draft (caption, hashtags, media references) |
| `GET` | `/api/v1/posts/:postId` | `post_service` | Fetch single post composition and metadata |
| `PUT` | `/api/v1/posts/:postId` | `post_service` | Update post content |
| `DELETE` | `/api/v1/posts/:postId` | `post_service` | Delete draft or scheduled post |

### Scheduling & Jobs
| Method | Route | Downstream | Description |
|--------|-------|------------|-------------|
| `POST` | `/api/v1/schedule/jobs` | `scheduler_service` | Create an Agenda.js background job for publishing |
| `GET` | `/api/v1/schedule/jobs` | `scheduler_service` | List scheduled jobs with status filters (`pending`, `running`, `completed`, `failed`) |
| `GET` | `/api/v1/schedule/jobs/:jobId` | `scheduler_service` | Retrieve job details and next run time |
| `DELETE` | `/api/v1/schedule/jobs/:jobId` | `scheduler_service` | Cancel a queued or recurring job |

### Platform Integration
| Method | Route | Downstream | Description |
|--------|-------|------------|-------------|
| `GET` | `/api/v1/platforms` | `platform_connector` | List supported platforms and connection health |
| `GET` | `/api/v1/platforms/:platform/status` | `platform_connector` | Verify OAuth token validity and permissions for the platform |
| `DELETE` | `/api/v1/platforms/:platform/disconnect` | `platform_connector` | Revoke OAuth tokens and unlink account |

### System
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Liveness probe; returns `200 OK` if the Node process is running |
| `GET` | `/ready` | Readiness probe; returns `200 OK` only when all downstream services are reachable |

## Internal Interfaces

The gateway communicates with downstream services over internal HTTP/1.1 using a shared Axios client instance configured per service:

```javascript
// Example internal client configuration
const serviceClient = axios.create({
  baseURL: process.env.USER_SERVICE_URL, // e.g., http://user-service:3000
  timeout: 15000,
  headers: { 'Accept': 'application/json' },
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 })
});
```

Key internal interface patterns:

- **JWT Verification Middleware**: On each protected request, the gateway extracts the Bearer token and verifies its RS256 signature against the current public key cached from `auth_service`. The decoded payload (containing `userId`, `scope`, and `jti`) is attached to `req.auth` for downstream routing.
- **Service Proxy Headers**: Every internal request forwards the original `X-Request-ID`, `X-User-ID`, and `X-Client-Version` headers to maintain trace context.
- **Error Propagation**: Downstream HTTP error codes (`4xx`, `5xx`) are mapped to gateway responses. Business logic errors (e.g., invalid cron expression sent to `scheduler_service`) are forwarded with their original status and message bodies. Infrastructure errors (connection refused, timeout) are translated to `502 Bad Gateway` or `504 Gateway Timeout`.
- **Multipart Proxy**: For `/api/v1/media/upload`, the gateway uses a streaming parser (e.g., `busboy` or `multer` with memory storage disabled) to pipe the incoming file stream directly to `media_service` via `multipart/form-data` POST, avoiding buffering large video files in the gateway's memory.

## Data Ownership

The API Gateway is **stateless** and does not own any business-domain persistent data. It does not write to MongoDB, object storage, or the token vault. Ephemeral data handled during a request lifecycle includes:

- **Request/Response Streams**: Temporary HTTP bodies and multipart chunks during upload proxying.
- **JWT Public Key Cache**: In-memory cache (e.g., Node-cache or Redis if externalized) of `auth_service` public signing keys, refreshed on `maxAge` or signature-validation failure.
- **OpenAPI Schema Definitions**: In-process JSON schema objects used for request validation.
- **Routing Configuration**: Static route table mapping URL patterns to downstream service base URLs, loaded at startup from environment variables.

All user records, media metadata, job definitions, tokens, and platform credentials remain owned exclusively by the downstream services and their respective databases.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Downstream Service Timeout** | `scheduler_service` or `media_service` fails to respond within the Axios timeout (e.g., 30s for video processing). Client receives `504 Gateway Timeout`. | Implement circuit breakers (e.g., `opossum`) per route. Return `503 Service Unavailable` after threshold breaches to prevent cascading load. |
| **Auth Service Unavailable** | JWT public keys cannot be fetched; all protected routes return `401` or `503`. | Cache the last known public key set with a TTL fallback. If cache is stale, reject requests safely rather than allowing unauthenticated traffic. |
| **Invalid Large Upload** | A user uploads a 2 GB file or non-allowed MIME type, causing memory exhaustion or disk fill. | Enforce strict `limits` in the multipart middleware (`fileSize: 500MB`, `files: 5`) and MIME allowlists before any stream processing begins. |
| **Stale DNS / Service Discovery Failure** | Kubernetes DNS update lag causes requests to route to terminated pods of `post_service`. | Use keep-alive with short idle timeouts on internal HTTP agents and rely on the orchestrator's readiness checks to remove stale endpoints from the service pool. |
| **Request Payload Bomb** | Deeply nested JSON or massive arrays crash the JSON parser. | Configure `express.json({ limit: '100kb', strict: true })` and `urlencoded` limits. Reject oversized bodies with `413 Payload Too Large`. |
| **OAuth Token Expiry Mid-Request** | `platform_connector` returns `403` because a user's social media token expired during a long request chain. | The gateway forwards the `403` to the client with a specific error code (`PLATFORM_TOKEN_EXPIRED`) so the UI can trigger a re-auth flow via `auth_service`. |
| **Rate Limit Breach** | External platform APIs throttle publish requests; `platform_connector` propagates `429`. | The gateway surfaces `429 Too Many Requests` to clients with `Retry-After` headers sourced from `platform_connector` responses. |

## Scaling Considerations

- **Stateless Horizontal Scaling**: The gateway is deployed as a pool of identical Node.js processes behind a load balancer (e.g., NGINX Ingress or AWS ALB). No session affinity is required because authentication is entirely JWT-based.
- **Connection Pooling**: Each downstream service client maintains a reusable HTTP Agent with `keepAlive: true` and tuned `maxSockets` (e.g., 50 per target) to avoid TCP handshake overhead under high concurrency.
- **Upload Stream Management**: When scaling horizontally, ensure the load balancer supports streaming requests with long timeouts (minimum 120s) for `/api/v1/media/upload`. Avoid buffering proxies that materialize multi-hundred-megabyte uploads in memory.
- **Memory Boundaries**: Express middleware should not buffer request bodies for proxy routes. Use stream piping for media uploads and keep JSON body limits conservative. This prevents Pod Out-Of-Memory kills during traffic spikes.
- **Graceful Shutdown**: On `SIGTERM`, the gateway stops accepting new connections, waits for in-flight requests to complete (up to a 30s drain timeout), and then closes the HTTP server. This prevents abrupt disconnections during rolling deployments in Kubernetes.
- **Circuit Breaker Tuning**: Circuit thresholds must be calibrated per downstream service. For example, `auth_service` should have a higher failure tolerance (short timeout, 50% threshold) than `media_service` (long timeout, 20% threshold) due to differing workload characteristics.
- **Observability Overhead**: Inject request ID logging and distributed tracing (e.g., OpenTelemetry) at the gateway layer. Ensure log verbosity does not block the event loop under thousands of concurrent connections; use asynchronous log appenders (e.g., `pino`).