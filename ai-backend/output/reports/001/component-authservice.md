# AuthService

## Responsibilities

AuthService is an Express/Node.js microservice responsible exclusively for identity lifecycle and token issuance. It is intentionally **removed from the per-request validation hot path**; APIGateway verifies JWTs statelessly using a local JWKS cache.

- **User Registration**: Accepts email/password credentials, enforces uniqueness via MongoDB unique indexes, and stores passwords with adaptive hashing (Argon2id).
- **Authentication**: Validates credentials against stored hashes and initiates a session by issuing short-lived RS256-signed access tokens (15-minute expiry) and long-lived opaque refresh tokens.
- **Token Refresh**: Verifies refresh token hashes stored in MongoDB, detects replay attempts via rotation-violation logic, and issues new token pairs.
- **Logout & Revocation**: Invalidates refresh token families in MongoDB and records revoked access-token JTIs for downstream propagation to the RedisCluster bloom filter consumed by APIGateway.
- **Key Material Publication**: Exposes a JWKS endpoint (`/.well-known/jwks.json`) containing active public signing keys so APIGateway can refresh its local cache without a runtime dependency on AuthService.

## APIs and Interfaces

AuthService exposes a REST API over HTTPS. It sits behind APIGateway but is not invoked by APIGateway for standard request validation.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Create a new user account |
| `POST` | `/auth/login` | Authenticate and issue tokens |
| `POST` | `/auth/refresh` | Rotate a refresh token pair |
| `POST` | `/auth/logout` | Revoke active session tokens |
| `GET`  | `/.well-known/jwks.json` | Public JWKS for stateless validation |

### Request / Response Examples

**Register**
```json
POST /auth/register
{
  "email": "user@example.com",
  "password": "high-entropy-password"
}

201 Created
{
  "userId": "507f1f77bcf86cd799439011",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

**Login**
```json
POST /auth/login
{
  "email": "user@example.com",
  "password": "high-entropy-password"
}

200 OK
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "opaque-refresh-token-value",
  "expiresIn": 900
}
```

**JWKS**
```json
GET /.well-known/jwks.json

200 OK
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "auth-2024-01",
      "use": "sig",
      "n": "...",
      "e": "..."
    }
  ]
}
```

### Token Contract

- **Access Token**: JWT, RS256-signed, `kid` in header, claims include `sub` (userId), `jti`, `iat`, `exp`, `roles`.
- **Refresh Token**: Opaque high-entropy string (256-bit). Stored as SHA-256 hash in MongoDB with a TTL index.

### Consumer Interface

- **APIGateway**: Routes `/auth/*` traffic to AuthService. Does **not** call AuthService during general API request validation; JWT verification is performed locally using cached JWKS.
- **MongoDBCluster**: Primary used for consistent reads during login and refresh; writes for registration, token rotation, and revocation.

## Data Ownership

AuthService owns the following data stored in **MongoDBCluster**:

### `users` Collection
- **`_id`**: MongoDB ObjectId
- **`email`**: Unique indexed string; enforced at the application and database level
- **`passwordHash`**: Argon2id hash string (memory-hard, parameterized for ~250 ms verification latency)
- **`createdAt` / `updatedAt`**: ISODate timestamps

### `refresh_tokens` Collection
- **`tokenHash`**: SHA-256 of the opaque refresh token string; unique indexed
- **`userId`**: Reference to `users._id`; compound index with `issuedAt`
- **`jti`**: UUID for the token family
- **`issuedAt` / `expiresAt`**: ISODate; TTL index on `expiresAt` for automatic cleanup
- **`replacedBy`**: Set when rotation occurs; links to the next token family to enable replay detection

### Key Material
- **Private RSA signing key**: Loaded from a secrets manager (e.g., HashiCorp Vault or cloud KMS) into the pod filesystem at startup; never logged or exposed via API.
- **Public key set**: Derived from the private key and served statically via the JWKS endpoint.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **MongoDB primary unavailability** | Registration, login, and refresh fail hard (5xx). Existing API traffic with valid JWTs is unaffected because APIGateway validates statelessly. | Retry with exponential backoff; circuit-breaker on the MongoDB driver; alert on primary failover. |
| **CPU exhaustion from password hashing** | Argon2id verification blocks the Node.js event loop; latency spikes under registration or login storms. | Offload hashing to a `worker_threads` pool; HPA triggered at CPU > 70%; APIGateway rate-limits `/auth/*` endpoints. |
| **JWT signing key compromise** | An attacker can mint valid access tokens if the private key is leaked. | Support multiple `kid` values; implement automated key rotation (e.g., daily issuance key, 48-hour grace period in JWKS); emergency key revocation via JWKS removal. |
| **Refresh token replay** | A stolen refresh token used by both attacker and legitimate user causes a race. | Rotation-violation detection: if a used refresh token is presented again, immediately revoke the entire token family. |
| **JWKS endpoint outage** | APIGateway cannot refresh its local cache; tokens signed with new keys are rejected once the cache expires. | Serve JWKS from an in-memory cache with stale-while-revalidate; ensure APIGateway cache TTL (1 hour) exceeds AuthService deployment windows. |
| **Timing side-channel enumeration** | Different response times for non-existent email versus invalid password leak account existence. | Execute `argon2.verify` even when the user is not found using a dummy hash to maintain constant-time response paths. |
| **Clock skew** | `iat`/`exp` mismatch between AuthService and APIGateway nodes causes valid tokens to be rejected. | Run NTP daemons on all nodes; include configurable `clockTolerance` (e.g., 5 seconds) in the APIGateway JWT verifier. |

## Scaling Considerations

- **Stateless horizontal scaling**: AuthService nodes share no in-memory session state. Any replica can handle login or refresh requests. Scale via HPA on CPU and memory.
- **CPU-bound workload**: Password hashing and RSA signing are compute-intensive. Vertical scaling (faster single-core performance) improves p99 latency more effectively than horizontal scaling for individual requests. Use worker threads to prevent event-loop starvation.
- **Database connection pool sizing**: Size MongoDB connection pools conservatively (`min: 5`, `max: 20` per replica) because total AuthService traffic is orders of magnitude lower than URL resolution traffic. Monitor `connections.current` on the MongoDB primary during registration spikes.
- **Rate limiting delegation**: Per-IP and per-account rate limiting is enforced at APIGateway using RedisCluster, freeing AuthService from maintaining counter state.
- **Token lifetime trade-offs**: Short access tokens (15 minutes) minimize the blast radius of compromise and reduce reliance on real-time revocation checks. Long refresh tokens (7 days) reduce re-authentication load.
- **JWKS traffic isolation**: The `/.well-known/jwks.json` endpoint is read-heavy and cacheable. Serve it from a lightweight middleware stack that bypasses body parsers and auth guards to avoid unnecessary overhead.
- **Independent scaling profile**: Because AuthService is decoupled from the redirect hot path, it can run with a fixed small replica count (e.g., 2–4 instances) even when URLService and RedirectEdge scale to dozens of pods during viral traffic events.

## Related Diagrams

No paired component diagram is provided for this document.