## component-auth-service

### Responsibilities

The `auth_service` is the trust anchor for the social media automation platform. It manages identity proofing for end-users and authorization delegation for third-party social platforms, while ensuring that long-lived credentials never reside in application memory or operational logs.

- **OAuth Orchestration**: Initiates platform-specific OAuth 2.0 (and OAuth 1.0a where required) flows for Instagram, Facebook, Twitter/X, TikTok, LinkedIn, and YouTube. Generates `state` nonces and PKCE verifiers, validates callbacks, and exchanges authorization codes for access/refresh token pairs.
- **Token Handoff**: Immediately delegates acquired tokens to the `token_vault` via an internal encrypted interface. The auth service does not store access tokens, refresh tokens, or client secrets in `mongodb_ops` or local state.
- **Internal Session Management**: Issues and validates short-lived, signed JWTs (or opaque session references) for the platform’s own web dashboard and REST API consumers. Maintains session revocation lists for logout and security events.
- **Account Linking**: Persists the mapping between a platform `user_id` and external social `platform_account_id`, including granted scopes, connection timestamps, and link status (`active`, `revoked`, `expired`).
- **Proactive Refresh Coordination**: Publishes refresh directives to the `scheduler_service` and `job_worker` before tokens expire, ensuring the `publisher_service` always receives valid credentials from the `token_vault`.
- **Audit & Security Events**: Writes immutable authentication audit records (login attempts, token refreshes, scope changes, disconnections) to `mongodb_ops` for compliance and anomaly detection.

### APIs / Interfaces

#### Public REST API (Node.js / Express)
Mounted behind the `api_gateway` at `/v1/auth`.

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/connect/:platform` | Initiates OAuth flow. Returns platform authorization URL and stores `state` + PKCE in Redis. |
| `GET`  | `/callback/:platform` | Receives OAuth callback. Validates `state`, exchanges code, and hands tokens to `token_vault`. |
| `POST` | `/disconnect/:platform` | Revokes platform grant, deletes vault reference, and emits `auth.disconnected`. |
| `POST` | `/session` | Authenticates local user (email/password or SSO) and returns internal JWT. |
| `DELETE` | `/session` | Revokes internal JWT by adding `jti` to Redis revocation set. |
| `GET`  | `/verify` | Introspection endpoint for the `api_gateway` and other services to validate a Bearer token and retrieve `user_id` + scopes. |
| `POST` | `/refresh/:platform` | Admin/trigger endpoint to force an immediate token refresh for a linked social account. |

#### Internal Service Interfaces
- **`TokenVaultClient`** — HTTP/gRPC client encapsulating all communication with the `token_vault`. Methods:
  - `storeToken(linkId, accessToken, refreshToken, expiresAt)`
  - `rotateToken(linkId, newAccessToken, newRefreshToken)`
  - `deleteToken(linkId)`
- **`AuthMiddleware`** — Express middleware exported for mounting in the `api_gateway` and other services. Validates JWT signature against JWKS, checks Redis revocation list, and appends `req.authContext = { userId, sessionId, roles }`.
- **`PlatformResolver`** — Abstraction layer that returns platform-specific OAuth endpoints, scope strings, and redirect URI formatting.

#### Events / Messages
Published to Redis Streams (or internal bus) for downstream reaction:
- `auth.platform_connected` — `{ userId, platform, accountId, linkId, scopes }`
- `auth.platform_disconnected` — `{ userId, platform, accountId, reason }`
- `auth.token_refresh_succeeded` — `{ linkId, platform, nextRefreshAt }`
- `auth.token_refresh_failed` — `{ linkId, platform, errorCode, retryable }`

### Data Owned

The auth service minimizes sensitive data retention by design.

#### MongoDB (`mongodb_ops`)
- **`UserIdentity`** — `user_id` (UUID), `email` (unique, indexed), `password_hash` (bcrypt/Argon2, if local auth), `mfa_secret` (encrypted), `created_at`, `updated_at`.
- **`PlatformAccountLink`** — `link_id` (UUID), `user_id` (indexed), `platform` (enum), `platform_account_id`, `token_vault_reference_id` (foreign pointer, not the token itself), `granted_scopes` (array), `connection_status`, `connected_at`, `last_refreshed_at`.
- **`OAuthState`** — `state_nonce` (hashed, unique, TTL 10 min), `platform`, `user_id`, `pkce_code_challenge`, `redirect_path`, `created_at`. MongoDB TTL index auto-expires stale entries.
- **`AuthAuditLog`** — Immutable documents for every authentication event; stored in a capped or time-series collection depending on volume.

#### Redis (`redis_cache`)
- **`session:{jti}`** — Hash containing `user_id`, `roles`, `ip`, `ua`. TTL aligned with JWT expiry (e.g., 24h).
- **`revoke:jti:{jti}`** — Sentinel key indicating a JWT has been explicitly logged out. TTL matches original JWT expiry.
- **`oauth:state:{nonce}`** — Serialized state payload with 5–10 minute TTL to prevent replay.
- **`ratelimit:auth:{ip}`** and **`ratelimit:auth:{user_id}`** — Counters for brute-force and enumeration protection.

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **OAuth provider timeout** | User cannot connect a social account; callback hangs. | 8-second timeout on code-exchange HTTP calls; circuit breaker in `platform_apis` layer; return `503` to client with `Retry-After`. |
| **Token vault unavailable during callback** | Tokens acquired from platform cannot be persisted. Risk of token loss. | Callback handler verifies vault health before code exchange. If vault write fails after exchange, tokens are queued in a Redis dead-letter stream for manual reconciliation; user sees "connection pending" rather than success. |
| **Redis partition (session cache)** | Gateway cannot validate sessions; users appear logged out. | JWT validation falls back to local JWKS cache (stateless verification). Revocation checks degrade: if Redis is unreachable, short-lived tokens (<15m) are accepted with elevated risk; longer-lived tokens are rejected until Redis recovers. |
| **MongoDB primary failure** | New sign-ups and platform links fail. Existing sessions continue if JWTs are valid and Redis is up. | Read from secondary replicas for `/verify` lookups; write operations queue with bounded retry; API Gateway returns `503` for mutating auth operations. |
| **Refresh token race condition** | Two `job_worker` instances refresh the same platform token simultaneously; one refresh invalidates the other. | Auth service delegates atomic rotation to `token_vault` compare-and-swap semantics. Workers request refresh through auth service, which serializes via a Redis distributed lock (`lock:refresh:{link_id}`) or vault-level versioning. |
| **State nonce replay / CSRF** | Attacker replays an old OAuth callback. | Single-use deletion: `OAuthState` document is deleted on first callback read. If already absent, request is rejected with `403`. TTL index ensures cleanup even if callback never arrives. |
| **Scope downgrade on platform** | User revokes permissions (e.g., removes `publish_actions`) outside the platform. | `publisher_service` reports ` insufficient_scope`. Auth service transitions `PlatformAccountLink.status` to `invalid_scopes` and notifies the user via `user_service` to re-authenticate. |

### Scaling Considerations

- **Stateless Horizontal Scaling**: The service is fully stateless. Deploy as a Node.js/Express replica set behind the `api_gateway`. Use Kubernetes HPA on CPU >70% or request rate >1k RPS per pod.
- **Event Loop Hygiene**: JWT signing and bcrypt hashing are CPU-bound. Keep cost low by using short-lived JWTs (15-minute access / 24-hour refresh) to reduce verification overhead. For high throughput, consider caching verified JWT payloads in a bounded in-memory LRU inside each pod (5-minute TTL) to avoid repeated Redis revocation checks.
- **Connection Pooling**: Maintain dedicated MongoDB connection pools (min: 5, max: 20) and Redis connection pools (min: 2, max: 10) per instance. Use `ioredis` cluster mode if Redis Cache is sharded.
- **OAuth Flow Isolation**: Authorization URL generation is I/O-light but callback handling involves multiple network hops (platform token endpoint + vault write). Isolate callback handlers on a separate Express router or worker pool so that heavy callbacks do not block lightweight `/verify` traffic.
- **Rate Limiting Integration**: All public endpoints enforce per-IP (100 req/min) and per-user (30 req/min) limits via the `rate_limiter` component. The `/connect/:platform` endpoint additionally enforces a per-user concurrency limit of 3 simultaneous OAuth attempts to prevent state-nonce exhaustion.
- **Database Indexing**: Ensure compound indexes on `PlatformAccountLink(user_id, platform, status)` and `AuthAuditLog(user_id, created_at)` to prevent table scans during token refresh jobs and audit queries.
- **Regional Consistency**: OAuth redirect URIs must be static and pre-registered with platforms. If deploying multi-region, use a single canonical callback domain (e.g., `auth.platform.com`) backed by the `api_gateway` with geo-routed load balancing, rather than region-specific subdomains.

### Related Diagrams

No paired component diagram was provided for this document. For contextual reference, see the following related diagrams:

- `diagrams/0350/iter4_auth-flow.mmd` — End-to-end OAuth and session authentication flow.
- `diagrams/0350/iter4_overview.mmd` — System-wide component topology and trust boundaries.