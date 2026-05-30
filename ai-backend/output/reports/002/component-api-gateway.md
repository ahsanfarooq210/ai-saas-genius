## API Gateway

### Responsibilities

- **Client Entry Point**: Exposes a single HTTPS surface for all web and mobile clients, shielding downstream microservices from direct external traffic.
- **Path-Based Routing**: Dispatches requests to the appropriate internal service—`Auth_Service`, `User_Service`, `Content_Service`, `Job_Service`, or `Media_Service`—based on URL path prefixes.
- **Request Validation & Sanitization**: Enforces JSON body size limits (non-media routes), parses `Content-Type`, and rejects malformed requests before they reach backend services.
- **Authentication Middleware**: Verifies `Authorization: Bearer <JWT>` tokens locally using a cached JWKS (JSON Web Key Set) retrieved from `Auth_Service`; rejects expired, malformed, or blacklisted tokens with a `401 Unauthorized`.
- **Application-Level Rate Limiting**: Enforces per-IP and per-user request quotas, returning `429 Too Many Requests` with standard `Retry-After` headers when limits are breached.
- **CORS & Security Policy**: Applies strict `Access-Control-Allow-Origin`, `Credentials`, and preflight handling for the frontend origin; injects security headers via Helmet.
- **Correlation & Observability**: Attaches a unique `x-request-id` to every incoming request and propagates it to all downstream service headers for distributed tracing.
- **Stream Proxying for Media**: Passes multipart photo/video uploads directly through to `Media_Service` via Node.js streams without buffering entire files in gateway memory.
- **Health & Readiness Probes**: Exposes a lightweight `GET /health` endpoint for load balancer health checks that does not depend on downstream service availability.

### APIs and Interfaces

#### Public Endpoint Surface

All client-facing routes are mounted under `/api/v1`. The gateway strips this prefix before proxying to downstream services.

| Method | Path | Downstream Target | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/*` | `Auth_Service` | Registration, login, logout, token refresh |
| `GET/POST` | `/api/v1/auth/oauth/:platform/*` | `Auth_Service` | OAuth initiation and callback flows |
| `GET/PATCH` | `/api/v1/users/*` | `User_Service` | Profile, connected accounts, preferences |
| `POST/GET` | `/api/v1/content/*` | `Content_Service` | Posts, captions, templates, hashtags |
| `POST/GET` | `/api/v1/jobs/*` | `Job_Service` | Schedule, list, and inspect Agenda.js jobs |
| `POST/GET` | `/api/v1/media/*` | `Media_Service` | Upload, retrieve, and delete media assets |
| `GET` | `/health` | Internal | Load balancer liveness probe |

#### Middleware Stack

```javascript
// Express middleware execution order
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(requestId());          // x-request-id injection
app.use(rateLimiter());        // per-IP & per-user tiers
app.use(authMiddleware());     // JWT validation (cached JWKS)
app.use(jsonParser({ limit: '10kb', strict: true })); // SKIP for /media/upload
app.use(router);               // path-based proxy to services
```

- **Media Upload Exception**: The `jsonParser` middleware is explicitly bypassed for `POST /api/v1/media/upload`. The gateway forwards the raw `multipart/form-data` stream to `Media_Service` using `req.pipe()`.
- **Auth Middleware Detail**: On startup, the gateway fetches the JWKS from `Auth_Service` and caches it in memory. Tokens are verified locally using `jsonwebtoken` with an `RS256` public key. The cache refreshes every 15 minutes or on key rotation.

#### Downstream Proxy Configuration

The gateway uses `http-proxy-middleware` (or equivalent) with the following per-target settings:

| Target | Timeout | Proxy Options |
|---|---|---|
| `Auth_Service` | 10 s | `changeOrigin: true`, path rewrite `^/api/v1/auth` → `/` |
| `User_Service` | 10 s | `changeOrigin: true`, path rewrite `^/api/v1/users` → `/` |
| `Content_Service` | 15 s | `changeOrigin: true`, path rewrite `^/api/v1/content` → `/` |
| `Job_Service` | 30 s | `changeOrigin: true`, path rewrite `^/api/v1/jobs` → `/`; extended timeout for batch scheduling |
| `Media_Service` | 120 s | `changeOrigin: true`, path rewrite `^/api/v1/media` → `/`, `selfHandleResponse: false` for streaming |

#### Request & Response Contract

- **Success Response** (gateway does not modify body; passes downstream JSON through):
  ```json
  {
    "success": true,
    "data": { ... },
    "requestId": "uuid-v4"
  }
  ```
- **Error Response** (enforced uniformly when the gateway itself generates the error):
  ```json
  {
    "success": false,
    "error": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "requestId": "uuid-v4"
  }
  ```
- **Rate Limit Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed in the current window.
  - `X-RateLimit-Remaining`: Remaining requests in the current window.
  - `X-RateLimit-Reset`: Unix timestamp when the window resets.

### Data Owned

The API Gateway is **stateless** and does not persist data to MongoDB or any other database. It maintains only ephemeral, process-local state:

- **JWKS Cache**: In-memory cache of `Auth_Service` public signing keys used for local JWT verification. Refreshed asynchronously on a schedule or on verification failure.
- **Route Configuration Table**: Environment-driven mapping of path prefixes to downstream base URLs (e.g., `USER_SERVICE_URL=http://user-service:3000`). Loaded at startup.
- **Rate Limit Windows**: In-memory sliding-window counters when operating without a shared store (see Scaling Considerations).
- **Active Connection Pools**: Persistent HTTP agents (`http.Agent` with `keepAlive: true`) to each downstream service to reduce TCP handshake overhead.
- **Request Log Buffer**: Unstructured stdout/stderr log streams captured by the container orchestrator; not retained locally.

### Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Downstream Service Timeout** | Client receives `504 Gateway Timeout` if `Auth_Service`, `Job_Service`, etc., exceed proxy timeout. Degraded user experience and potential retry storms. | Aggressive timeout values per route (see table above); return structured `504` errors without cascading retries at the gateway layer. |
| **Rate Limit Breach** | Authenticated or anonymous client exceeds tier limit; all subsequent requests return `429` until window resets. | Clients must honor `Retry-After` header. Gateway logs blocked IPs/user IDs for security review. |
| **JWKS Refresh Failure** | If `Auth_Service` is unreachable during a key rotation, cached keys eventually expire and all authenticated requests return `401`. | Startup hard dependency on initial JWKS fetch; runtime refresh failures retain stale cached keys for a grace period (e.g., 2× refresh interval) before marking readiness probe as failed. |
| **Media Upload Stream Interruption** | Client disconnects or `Media_Service` becomes unreachable mid-upload, leaving open file descriptors and memory pressure. | Destroy the incoming `req` stream immediately on `proxyReq` error or timeout; ensure `http.Agent` maxSockets limits are enforced. |
| **Event Loop Saturation** | A burst of heavy requests (e.g., bulk job scheduling to `Job_Service`) blocks the single-threaded event loop, causing health probes to fail and the instance to be marked unhealthy. | Offload JSON parsing limits, use streaming for uploads, and enforce concurrent connection limits per client IP. |
| **Routing Misconfiguration** | Stale or incorrect `*_SERVICE_URL` environment variables cause 404s or requests routed to the wrong microservice. | Validate route table against a discovery schema at boot; fail fast if a required downstream URL is unreachable. |
| **OAuth Callback Flooding** | Social platforms redirect large bursts of users to `/auth/oauth/:platform/callback`, exhausting rate limit windows or connection pools. | Apply a separate, more permissive burst limit (e.g., 50 req/10s per IP) for OAuth callback paths distinct from general API limits. |

### Scaling Considerations

- **Stateless Horizontal Scaling**: The gateway can be scaled to multiple Node.js processes or containers behind a layer-4/layer-7 load balancer. No session affinity (sticky sessions) is required because JWTs are self-contained.
- **Rate Limit Store Consistency**: The default in-memory rate limiter is accurate only within a single process. When running multiple gateway replicas, per-user limits become inconsistent. For strict cross-instance enforcement, integrate a shared store (e.g., `Redis_Cache`) via an `express-rate-limit` Redis store, or offload coarse-grained limits to an upstream edge gateway (e.g., Nginx, Kong, Cloudflare).
- **Connection Pool Management**: Each gateway instance maintains `keepAlive` TCP connections to five downstream services. Under high replica counts, ensure downstream services can handle the aggregate connection pool size (`replicas × maxSockets`).
- **Media Upload Throughput**: Large video uploads must stream through without buffering. Do not enable request body parsing or middleware that materializes the stream into memory. Deploy gateway instances with sufficient network bandwidth and configure load balancer idle timeouts > 120 seconds for media routes.
- **TLS Termination Offload**: CPU-intensive TLS handshakes should be terminated at the cloud load balancer or ingress controller before traffic reaches the Node.js process, freeing the gateway event loop for application logic.
- **Graceful Shutdown**: On `SIGTERM`, stop accepting new connections, drain existing requests within a 30-second grace period, and close downstream proxy agents cleanly to prevent in-flight job scheduling or media uploads from being abruptly truncated.