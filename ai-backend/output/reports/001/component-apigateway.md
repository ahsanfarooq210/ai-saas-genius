# APIGateway

## Responsibilities

- **Managed L7 Ingress Termination**: Serves as the single public ingress point for all dynamic API traffic (`ReactSPA` → `APIGateway`). Terminates TLS 1.3, enforces HSTS, and offloads SSL computation from `URLService` and `AuthService`.
- **Stateless JWT Validation**: Validates `Authorization: Bearer <token>` signatures locally using an in-memory JWKS cache. Extracts claims (`sub`, `role`, `jti`) and forwards them as `X-User-Id`, `X-Role`, and `X-Token-Jti` headers to upstream services. This design removes `AuthService` from the request validation hot path.
- **Rate Limit Enforcement**: Consults `RedisCluster` to enforce per-user and per-IP rate limits. Uses Redis-backed sliding windows with atomic `INCR` + `EXPIRE` pipelines (or `CL.THROTTLE` if using Redis-Cell). Returns `429 Too Many Requests` with `Retry-After` headers when limits are breached.
- **Token Revocation Checks**: Queries the revoked-token Bloom filter in `RedisCluster` for the `jti` claim after signature validation. Blocks requests carrying revoked tokens with `401 Unauthorized`.
- **Intelligent Routing**: Routes `/api/urls/*` to the `URLService` upstream pool and `/api/auth/*` to the `AuthService` pool. Supports path stripping or prefix preservation based on upstream contract.
- **Edge Security & Hardening**: Enforces CORS policies for the `ReactSPA` origin, strips `Server` and `X-Powered-By` headers, injects `X-Request-Id` correlation IDs, and rejects malformed payloads at the edge (`413 Payload Too Large` for bodies > 1 MB).
- **Observability Surface**: Emits structured access logs (JSON) including total latency, upstream response time, JWT validation outcome, and rate-limit key. Exposes Prometheus RED metrics (`http_requests_total`, `http_request_duration_seconds`, `http_requests_in_flight`).

## APIs & Interfaces

### Northbound (Clients → APIGateway)
- **Protocol**: HTTPS (HTTP/2 preferred, HTTP/1.1 fallback) on port 443.
- **Authentication**: `Authorization: Bearer <JWT>` header for protected routes; `/api/auth/login` and `/api/auth/register` are unprotected.
- **Response Headers**:
  - `X-RateLimit-Limit`: Request quota per window.
  - `X-RateLimit-Remaining`: Remaining requests in current window.
  - `X-RateLimit-Reset`: UTC timestamp of window reset.
- **CORS**: Preflight `OPTIONS` responses configured for the `ReactSPA` origin with allowed headers `Content-Type`, `Authorization`.

### Southbound (APIGateway → Upstream Services)
- **URLService**: Forwarded over HTTP/1.1 (or HTTP/2 if supported) inside the VPC. Path prefix `/api/urls` retained.
  - Injected headers: `X-User-Id`, `X-Role`, `X-Request-Id`.
- **AuthService**: Forwarded over HTTP/1.1 inside the VPC for login, registration, and JWKS refresh.
  - Path prefix `/api/auth` retained.
- **RedisCluster**: Redis protocol (RESP2/RESP3) over TCP.
  - Keys: `ratelimit:api:<endpoint>:<userId>`, `ratelimit:api:<endpoint>:<ip>`, `revoked:bloom`.
  - Operations: `INCR`/`EXPIRE` or `CL.THROTTLE` for rate limits; `BF.EXISTS` (RedisBloom) for revoked-token checks.
  - Client behavior: Pipelined multi-key operations where possible; cluster-aware slot routing.

### Management & Bootstrap
- **JWKS Refresh**: Background job fetches `GET /.well-known/jwks.json` from `AuthService` every 5 minutes or on unrecognized `kid`. Populates the local in-memory cache.

## Data Ownership

| Data | Storage Location | Persistence | Description |
|---|---|---|---|
| **JWKS Cache** | In-memory (process-local) | Ephemeral | Map of `kid` → public key (RSA/JWK). Rebuilt from `AuthService` on boot and refreshed every 5 min. |
| **Rate Limit Counters** | `RedisCluster` | Ephemeral (TTL) | Atomic counters per key with 60–300 s TTL. Gateway is the writer; data is not durable. |
| **Revoked Token Bloom Filter** | `RedisCluster` | Semi-durable | Bloom filter populated by `AuthService` on logout/token refresh. Gateway performs membership checks only. |
| **Route Configuration** | In-memory (process-local) | Ephemeral | Static path-to-upstream mapping loaded at startup from environment variables or ConfigMap. |

The gateway owns **no durable OLTP data** and is horizontally stateless.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **JWKS Cache Miss + AuthService Down** | New requests bearing an unknown `kid` fail JWT validation (`401`). | Stale-while-revalidate: serve cached keys up to 2× TTL (e.g., 10 min grace). Emit alert if refresh fails >1 min. |
| **RedisCluster Network Partition** | Rate limit and revocation checks fail. | Degrade to in-process token-bucket rate limiter per pod (approximate, but protects upstream). For revocation checks, fail closed (reject request) if partition lasts >2 s, forcing re-auth. |
| **AuthService Upstream Timeout** | Login/registration requests return `504 Gateway Timeout`. | Gateway enforces 10 s upstream timeout; circuit breaker opens after 50% error rate over 30 s, fast-failing with `503` for 60 s. JWT validation remains unaffected. |
| **URLService Upstream Timeout** | URL mutations/reads return `504`. | Timeout 5 s; retry idempotent `GET`s once on `502/503`. Non-idempotent `POST/DELETE` are not retried. |
| **Hot Rate-Limit Key** | Single user/IP goes viral; one Redis shard saturates. | Gateway maintains a local leaky-bucket pre-check. Only a fraction of requests (or only after local bucket drain) hits Redis for global sync, reducing shard pressure. |
| **Token Clock Skew** | Valid tokens rejected due to `nbf`/`exp` boundary issues. | Allow 60 s leeway on `iat`, `nbf`, and `exp` claims. Enforce NTP synchronization on all gateway nodes. |
| **Request Body Bomb** | Large payloads exhaust gateway memory/CPU. | Enforce strict `Content-Length` limit (1 MB) and abort connection on oversize bodies before forwarding. |

## Scaling Considerations

- **Horizontal Pod Autoscaling**: Scale replicas on CPU > 60% **and** concurrent connections > 80% of pool capacity. Minimum 3 replicas across 3 availability zones; maximum bounded by `RedisCluster` connection limits (e.g., 100 gateway pods per Redis shard).
- **Keep-Alive & Connection Reuse**: Persistent HTTP/1.1 keep-alive and HTTP/2 multiplexed streams to `URLService`/`AuthService` pods. Eliminates TCP/TLS handshake overhead during traffic spikes.
- **RedisCluster Connection Pooling**: Each gateway replica maintains a bounded async connection pool (e.g., 20 connections per Redis primary/replica) using a cluster-aware client. Prevents connection storms when scaling out.
- **Local JWKS Cache**: Eliminates per-request chatter with `AuthService`, allowing the auth service to scale independently and sparing it from read amplification during viral events.
- **Regional Affinity**: Since redirect traffic is absorbed by `CDNEdge`, the gateway only serves API traffic. It can be deployed in a single primary region (or active-active if the `ReactSPA` user base is global) behind an anycast IP without needing to follow the redirect edge globally.
- **Cost Control**: Ensure the managed ingress pricing model is strictly pay-per-request for API calls only. Redirect `301` traffic must never route through `APIGateway`; validate via separate DNS/hostname routing (e.g., `api.shortener.com` vs `shortener.com`).