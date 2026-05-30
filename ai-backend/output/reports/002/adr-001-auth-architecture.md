# ADR-001: Authentication and Authorization Architecture

## Status
Accepted

## Context
The social media automation platform must authenticate end-users and authorize publishing actions across external social networks (Instagram, Twitter/X, Facebook, LinkedIn, TikTok). The backend is Node.js/Express with MongoDB as the primary database, Redis for caching, and Agenda.js for background jobs. Users connect personal or business accounts via OAuth 2.0, and the system publishes media on their behalf using stored access tokens. This ADR records the decision to centralize all authentication and token-management concerns in a dedicated `Auth_Service`, supported by `Redis_Cache` for hot tokens and sessions, and `MongoDB` for persistent credential storage.

## Decision
All user authentication (local JWT-based sessions) and social-platform OAuth flows will be owned by `Auth_Service`.  
`API_Gateway` will validate JWTs and route auth-related traffic.  
`Auth_Service` will store refresh tokens and encrypted access tokens in `MongoDB`, cache active tokens and sessions in `Redis_Cache`, and vend short-lived platform tokens to `Publish_Service` on demand.  
`User_Service` will retain profile data and social-account metadata but will not directly possess OAuth secrets.  
Token refresh will be performed by `Auth_Service` synchronously on cache miss/expiry and asynchronously via `Agenda_Queue` to preemptively refresh tokens approaching expiration.

---

## Responsibilities

| Component | Authentication Responsibilities |
|-----------|--------------------------------|
| **API_Gateway** | Terminates TLS; enforces rate limiting on `/auth/*`; validates JWT `Authorization` headers; forwards OAuth callback queries to `Auth_Service`. |
| **Auth_Service** | Local user registration/login (bcrypt password hashes); JWT issuance and rotation; OAuth 2.0 initiation and callback handling for all platforms; secure storage of OAuth tokens; on-demand token refresh; token vending to internal services (`Publish_Service`, `Job_Service`). |
| **User_Service** | Stores user profiles, connected-account metadata (platform user ID, account handle, avatar URL), and posting preferences. Receives account-linkage events from `Auth_Service` but never handles secrets. |
| **Redis_Cache** | Caches active JWT sessions (`session:{userId}`), short-lived platform access tokens (`oauth:token:{accountId}`), and ephemeral OAuth `state` nonces during authorization flows. |
| **MongoDB** | Persistent store for user password hashes, refresh tokens (encrypted at rest), token expiry times, and audit logs of auth events. |
| **Publish_Service** | Consumes platform-specific access tokens from `Auth_Service` immediately before calling external `Platform_APIs`. Does not cache tokens locally. |

---

## APIs and Interfaces

### External (via API Gateway)
```http
POST /auth/register
Body: { email, password }
Response: { userId, accessToken, refreshToken }

POST /auth/login
Body: { email, password }
Response: { userId, accessToken, refreshToken }

GET /auth/oauth/:platform/start?accountType=business
Response: 302 Redirect to platform authorization URL

GET /auth/oauth/:platform/callback?code=&state=
Response: 302 Redirect to client with ?connected=true|false
```

### Internal (service-to-service)
```http
POST /internal/auth/token/refresh
Body: { accountId }
Response: { accessToken, expiresAt }
# Called by Auth_Service background jobs or on-demand.

GET /internal/auth/tokens/:accountId?platform=instagram
Headers: X-Service-Key: <publish-service-secret>
Response: { accessToken, tokenType, expiresAt }
# Called by Publish_Service before every publish job.

POST /internal/auth/revoke
Body: { accountId, reason }
# Called by User_Service or by Auth_Service when refresh fails.
```

### Redis Key Contracts
- `session:{userId}:{jti}` → JSON `{ refreshTokenHash, issuedAt }` (TTL = refresh token lifetime)
- `oauth:token:{accountId}` → `{ accessToken, expiresAt }` (TTL = token remaining lifetime, max 1 hour)
- `oauth:state:{nonce}` → `{ userId, platform, redirectUri }` (TTL = 10 minutes)

---

## Data Ownership

| Store | Collection / Key Space | Owner | Contents |
|-------|------------------------|-------|----------|
| **MongoDB** | `users` | `Auth_Service` | `_id`, `email`, `passwordHash`, `emailVerified`, `createdAt` |
| **MongoDB** | `oauth_credentials` | `Auth_Service` | `accountId`, `userId`, `platform`, `encryptedAccessToken`, `encryptedRefreshToken`, `scope`, `expiresAt`, `connectedAt`, `isActive` |
| **MongoDB** | `auth_events` | `Auth_Service` | Audit trail of logins, token refreshes, revocations |
| **MongoDB** | `user_profiles` | `User_Service` | Display name, timezone, preferences; references `users._id` |
| **MongoDB** | `social_accounts` | `User_Service` | `platformUserId`, `platform`, `accountName`, `avatarUrl`; references `oauth_credentials.accountId` |
| **Redis** | `session:*` | `Auth_Service` | Ephemeral session metadata |
| **Redis** | `oauth:token:*` | `Auth_Service` | Cached plaintext access tokens (transient) |

> **Note:** OAuth tokens at rest in MongoDB are encrypted using AES-256-GCM with a key held in the runtime secret manager (e.g., AWS Secrets Manager / HashiCorp Vault). Redis holds only short-lived cached tokens.

---

## Token Lifecycle and OAuth Flow

1. **Connection Initiation**  
   Client → `API_Gateway` → `Auth_Service` generates a PKCE or standard OAuth URL with a `state` nonce, stores `oauth:state:{nonce}` in Redis, and returns the redirect.

2. **Platform Callback**  
   Platform → `API_Gateway` → `Auth_Service` verifies `state`, exchanges code for tokens via `Platform_APIs`, encrypts tokens, writes to `MongoDB`, caches access token in Redis, and emits an `account.connected` event to `User_Service` and `Notification_Service`.

3. **Publishing**  
   `Job_Service` triggers `Publish_Service`. `Publish_Service` calls `GET /internal/auth/tokens/:accountId`. If Redis has a valid cached token, it is returned immediately. If missing or expired, `Auth_Service` decrypts the refresh token from MongoDB, calls the platform refresh endpoint, updates MongoDB and Redis, and returns the new access token.

4. **Preemptive Refresh**  
   An Agenda.js background job (`token.refresh.scheduler`) runs every 15 minutes, querying MongoDB for tokens expiring within 30 minutes. It refreshes them in the background and updates Redis, minimizing publish-time latency.

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Platform rejects refresh token** (user revoked access) | Publish jobs for that account fail immediately. | `Auth_Service` marks `oauth_credentials.isActive = false`, emits `account.disconnected` event; `Notification_Service` alerts user via email and WebSocket; `Job_Service` cancels pending jobs for that account. |
| **Redis unavailable** | Increased latency for token lookup; publish jobs slower. | `Auth_Service` falls back to MongoDB decryption. Circuit breaker in `Publish_Service` prevents cascading retries. |
| **OAuth rate limiting by platform** (e.g., Twitter v2) | Token refresh or publish fails with HTTP 429. | `Auth_Service` inspects `Retry-After` headers and delays refresh via Agenda.js job. `Publish_Service` reschedules the publish job via `Job_Service`. |
| **Clock skew causing JWT validation failures** | Users cannot access API. | `API_Gateway` allows a 60-second leeway in `jsonwebtoken` verification. NTP synchronization enforced on all nodes. |
| **Duplicate OAuth callback** (user double-clicks, network retry) | Potential duplicate token records or race conditions. | `Auth_Service` uses Redis distributed lock (`redlock`) on `state` nonce consumption; idempotent insert into `oauth_credentials` with `ON CONFLICT` style upsert on `(userId, platformUserId)`. |
| **Long-lived job queued past token expiry** | `Publish_Service` receives expired token at execution time. | `Job_Service` passes `accountId` only; `Publish_Service` always resolves tokens at execution time, never at enqueue time. |
| **Mass token expiry event** (platform policy change) | Thundering herd of refresh requests. | `Auth_Service` serializes refresh attempts per account using Agenda.js job uniqueness (`unique: { 'data.accountId' }`) and exponential backoff. |

---

## Scaling Considerations

- **Stateless Service:** `Auth_Service` nodes share no local state; all session and token data lives in `Redis_Cache` and `MongoDB`. Horizontal pod autoscaling based on CPU and request latency is safe.
- **Redis Cluster:** Session and token keys are sharded by `userId` or `accountId`. Hot keys for popular creators are mitigated by short TTLs (access tokens cached ≤1 hour) and read replicas for token validation.
- **MongoDB Reads:** `oauth_credentials` queries use a compound index `{ userId: 1, platform: 1, isActive: 1 }`. Background token refresh jobs read by `{ expiresAt: 1 }` with a covered index.
- **Preemptive Refresh Job:** The Agenda.js `token.refresh.scheduler` job uses a single worker lock (`jobLock`) to prevent duplicate refresh scans across scaled `Job_Service` instances.
- **API Gateway Rate Limiting:** Auth endpoints use stricter per-IP and per-email rate limits (e.g., 5 login attempts / 15 min) to prevent brute force and OAuth flow abuse.
- **Token Payload Size:** JWTs contain only `userId`, `jti`, and `role`; platform scopes and large metadata remain server-side to keep headers small.

---

## Consequences

- **Positive:** Centralized security boundary; clear data-ownership split between auth secrets (`Auth_Service`) and business metadata (`User_Service`); reusable token vending for future services; preemptive refresh keeps publish latency low.
- **Negative:** `Auth_Service` is a single point of failure for publishing. If it is down, `Publish_Service` cannot retrieve tokens. Mitigated by Redis fallback, circuit breakers, and health-check-based load-balancer ejection.
- **Risk:** Storing social-platform tokens in a single MongoDB collection creates a high-value target. Mitigated by field-level encryption, least-privilege DB credentials, and regular secret rotation.

## Related Diagrams
- `diagrams/002/iter1_overview.mmd`