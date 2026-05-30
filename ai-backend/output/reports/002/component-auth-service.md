## Auth Service

### Overview
The Auth Service is a Node.js/Express microservice responsible for all identity and authorization concerns in the social media automation platform. It manages local user registration and authentication via JWTs, orchestrates OAuth 2.0 authorization flows for external platforms (Instagram, Twitter/X, Facebook, LinkedIn, TikTok), and secures the lifecycle of platform-specific access tokens. It persists credential data in MongoDB and uses Redis for ephemeral OAuth state, session caching, and distributed rate limiting.

---

### Responsibilities

* **Local Identity Management**: Registration, login, password hashing (bcrypt), and JWT access/refresh token issuance.
* **OAuth 2.0 Orchestration**: Initiates platform-specific authorization code flows, manages `state` and PKCE `code_verifier` parameters, and handles callback exchange.
* **Social Token Vault**: Encrypts (AES-256-GCM) and stores platform access/refresh tokens; decrypts them on-demand for downstream services.
* **Token Lifecycle**: Automated refresh of expired social tokens, revocation on user disconnect, and cleanup of stale refresh tokens.
* **Authentication Middleware**: Provides token introspection and JWT verification for the API Gateway and internal services.
* **Security Controls**: Login rate limiting, account lockout on repeated failures, and secret rotation for JWT signing keys.

---

### APIs and Interfaces

#### External-Facing (via API Gateway)
All routes expect `Content-Type: application/json` and return standardized error envelopes (`{ error, code, message }`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Creates a local user. Body: `{ email, password }`. Returns `{ userId, accessToken, refreshToken }`. |
| `POST` | `/auth/login` | Authenticates a user. Body: `{ email, password }`. Returns a new JWT pair. |
| `POST` | `/auth/logout` | Revokes the caller’s refresh token. Requires `Authorization: Bearer <accessToken>`. |
| `POST` | `/auth/refresh` | Rotates refresh token. Body: `{ refreshToken }`. Returns new `{ accessToken, refreshToken }`. |
| `GET`  | `/auth/oauth/:platform/connect` | Starts OAuth flow. Query: `?redirectUri=<clientCallback>`. Returns a 302 redirect to the platform authorize URL. |
| `GET`  | `/auth/oauth/:platform/callback` | Platform callback. Query: `?code=&state=`. Exchanges code for tokens, encrypts them, and redirects to client. |
| `DELETE` | `/auth/accounts/:platformAccountId` | Disconnects a social account, revokes tokens, and purges caches. |

#### Internal-Facing (Service-to-Service)
These routes are restricted to the cluster mesh (e.g., via internal network policies or mTLS).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/internal/auth/verify` | Validates an access JWT. Returns `{ valid: true, userId, email, scopes, exp }` or `401`. |
| `GET` | `/internal/auth/users/:userId/tokens/:platform` | Returns decrypted platform token payload for the **Publish Service**. Returns `{ accessToken, expiresAt, metadata }`. |
| `POST` | `/internal/auth/tokens/:platform/refresh` | Forces immediate refresh of a social token. Used by **Publish Service** on `401/403` from a Platform API. |
| `POST` | `/internal/auth/revoke` | Revokes tokens by ID. Body: `{ tokenIds[], reason }`. Used during security events. |

#### Key Contracts
* **JWT Access Token**: `HS512` or `RS256` signed, `exp` 15 minutes, `kid` header for key rotation.
* **Refresh Token**: Opaque 128-byte random string, hashed with SHA-256 before storage in MongoDB.
* **Social Tokens**: Encrypted at the application layer before MongoDB write; encryption key retrieved from a secret manager at startup.

---

### Data Owned

#### MongoDB Collections
The Auth Service owns the following collections. It does **not** own user profile data or posting preferences (managed by the User Service).

* **`local_credentials`**
  * `userId` (ObjectId, unique)
  * `email` (string, unique, indexed)
  * `passwordHash` (string, bcrypt)
  * `failedLoginAttempts` (number)
  * `lockedUntil` (Date, nullable)
  * `createdAt`, `updatedAt`

* **`social_tokens`**
  * `userId` (ObjectId, indexed)
  * `platform` (string enum: `instagram`, `twitter`, `facebook`, `linkedin`, `tiktok`)
  * `platformAccountId` (string)
  * `encryptedAccessToken` (BinData / string ciphertext)
  * `encryptedRefreshToken` (BinData / string ciphertext)
  * `scope` (string)
  * `expiresAt` (Date)
  * `isValid` (boolean, default `true`)

* **`refresh_tokens`**
  * `tokenId` (UUID, unique)
  * `userId` (ObjectId, indexed)
  * `hashedToken` (string, SHA-256)
  * `issuedAt`, `expiresAt` (Date)
  * `revokedAt` (Date, nullable)
  * `ipAddress`, `userAgent` (string, audit fields)

#### Redis Keys
* `session:{userId}:{jti}` — Active JWT session metadata (TTL = token `exp`).
* `oauth_state:{state}` — Temporary OAuth flow context including `platform`, `userId`, `codeVerifier`, `redirectUri` (TTL = 5 minutes).
* `token_cache:platform:{userId}:{platformAccountId}` — Decrypted platform access token (TTL = 5 minutes) to reduce encryption CPU load.
* `rate_limit:auth:{ip}` — Login attempt counter (TTL = 15 minutes).
* `revoked_jti:{jti}` — Blocklist for JWTs after logout or security event (TTL = remaining token lifetime).

---

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Social OAuth Denial / Callback Expiry** | User cannot connect an account; stale `oauth_state` records accumulate. | Enforce strict 5-minute TTL on `oauth_state` in Redis; validate `state` exactly once and delete immediately on callback. Return `400` with descriptive error code (`oauth_state_expired`). |
| **Platform Token Refresh Rejection** | Publish Service receives `401` and cannot post. The user’s social token is externally revoked or expired. | Publish Service calls `/internal/auth/tokens/:platform/refresh`. If refresh fails, Auth Service sets `social_tokens.isValid = false`, returns `410 Gone` to Publish Service, and triggers a notification via the Notification Service. |
| **MongoDB Unavailability During Login** | Users cannot authenticate; system-wide outage for new sessions. | Return `503 Service Unavailable`. Existing sessions continue to work via Redis `session:*` cache. API Gateway should degrade to cached JWKS validation for already-issued tokens. |
| **Redis Unavailability** | Loss of rate limiting consistency; inability to cache decrypted tokens; OAuth state lost. | Fallback to in-memory per-process rate limiter (less strict but functional). Fallback to direct MongoDB reads for token verification. OAuth flows fail fast with `503` rather than write state to MongoDB to avoid inconsistent state machines. |
| **JWT Signing Key Compromise** | Attacker can forge tokens. | Implement JWKS endpoint (`GET /.well-known/jwks.json`) with `kid` rotation. Maintain a short key rotation window (e.g., 24-hour overlap). API Gateway caches JWKS with a short TTL to pick up new keys quickly. |
| **Credential Stuffing / Brute Force** | Account takeover risk; resource exhaustion. | Redis-backed rate limiting (`rate_limit:auth:{ip}`): 5 attempts per 15 minutes. After 5 failures, increment `failedLoginAttempts` in MongoDB and lock account for 30 minutes. |
| **Clock Skew in JWT Validation** | Legitimate tokens rejected due to server time drift. | Allow a 60-second leeway in `exp`/`nbf` checks using the `jsonwebtoken` library `clockTolerance` option. |

---

### Scaling Considerations

* **Stateless Instances**: The service is fully stateless. JWT verification relies on shared secrets/JWKS, and session data lives in Redis. This allows horizontal pod autoscaling based on CPU/memory or request queue depth.
* **Offload JWT Verification**: The hottest path is token verification on every API call. The API Gateway should cache the JWKS and verify JWTs locally using the `Authorization` header, only calling `/internal/auth/verify` for edge cases (e.g., token format changes, custom claims checks). This reduces Auth Service traffic by >90%.
* **Social Token Cache**: Decrypting AES-256 tokens from MongoDB on every publish job is CPU-intensive. The 5-minute Redis cache (`token_cache:platform:*`) reduces decryption load, but cache invalidation must fire immediately on token refresh or disconnect.
* **MongoDB Connection Pooling**: OAuth callbacks are bursty (e.g., after a mobile app prompt). Configure Mongoose with `maxPoolSize: 50` per instance and ensure the MongoDB cluster can handle connection spikes during bulk onboarding events.
* **Database Sharding**: The `social_tokens` collection can grow rapidly (one doc per connected account). Shard MongoDB by `userId` to distribute writes evenly. `refresh_tokens` should have a TTL index on `expiresAt` to auto-prune.
* **Distributed Rate Limiting**: Use a Redis-backed rate limiter (e.g., `rate-limiter-flexible`) rather than in-memory Node.js maps. This ensures consistent enforcement across replicas during rolling deployments.
* **Secret Rotation Without Downtime**: JWT signing keys and AES encryption keys must rotate without pod restarts. Mount keys via a sidecar from a secret manager (e.g., AWS Secrets Manager or Vault) into a shared volume that the Node.js process polls every 5 minutes, updating an in-memory JWKS cache.