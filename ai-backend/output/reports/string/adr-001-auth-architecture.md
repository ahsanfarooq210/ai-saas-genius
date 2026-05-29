## ADR-001: Authentication Architecture

**Status:** Accepted  
**Date:** 2024-05-20  
**Scope:** Cross-cutting user-session security for the social-media automation platform.

---

### Context

The platform exposes an Express.js API Gateway that routes public HTTP traffic to domain services (`accountService`, `preferenceService`, `jobScheduler`, etc.). All write operations—linking social accounts, storing publishing preferences, uploading media, and scheduling posts—must be tied to an authenticated user. Additionally, automated background jobs eventually act on behalf of a user, so the system needs a trusted user identity to resolve OAuth tokens and preferences.

The architecture must satisfy three constraints:

1. **Stateless API tier** – The API Gateway scales horizontally; it cannot hold server-side sessions.
2. **Decoupled social OAuth** – Credentials for Facebook, Instagram, TikTok, etc., are distinct from application login credentials and are managed by `accountService`, not the authentication layer.
3. **MongoDB as sole primary store** – No separate identity provider (e.g., Auth0, Cognito) is introduced; user credentials and token metadata live in the existing MongoDB cluster.

---

### Decision

We will implement a **stateless JWT-based session architecture** with the following rules:

- **`authService`** is the sole authority for user identity, password verification, JWT issuance, and refresh-token lifecycle.
- **Access tokens** are short-lived signed JWTs (RS256, 15-minute expiry) that carry the user identity.
- **Refresh tokens** are opaque, high-entropy strings persisted in MongoDB with a 7-day expiry and rotation on every use.
- **`apiGateway`** performs local JWT verification using a cached RSA public key fetched from `authService`; it does not call `authService` on every request.
- **Social-platform OAuth tokens** remain outside this ADR; they are stored encrypted by `accountService`.

---

### Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `authService` | User registration, bcrypt password hashing, login credential verification, RSA key-pair management, access-token signing, refresh-token generation & rotation, token revocation, JWKS publication. |
| `apiGateway` | JWT signature verification via cached public key, attaching `req.userId` and `req.tokenExp` to the request context, rejecting missing or malformed authorization headers before routing to downstream services. |
| `mongoDB` | Durably store user credential records and refresh-token documents; provide transactional consistency during token rotation. |

Downstream services (`preferenceService`, `accountService`, etc.) trust the `userId` injected by the Gateway and do **not** re-validate the JWT signature.

---

### APIs / Interfaces

#### Public HTTP Surface (routed through `apiGateway`)

```http
POST /api/v1/auth/register
Body: { "email": string, "password": string }
Response: 201 Created
  { "accessToken": string, "refreshToken": string, "tokenType": "Bearer" }

POST /api/v1/auth/login
Body: { "email": string, "password": string }
Response: 200 OK
  { "accessToken": string, "refreshToken": string, "tokenType": "Bearer" }

POST /api/v1/auth/refresh
Body: { "refreshToken": string }
Response: 200 OK
  { "accessToken": string, "refreshToken": string, "tokenType": "Bearer" }

POST /api/v1/auth/logout
Headers: Authorization: Bearer <accessToken>
Body: { "refreshToken": string }
Response: 204 No Content
```

#### Internal / Infrastructure Endpoints

```http
GET /.well-known/jwks.json
Host: authService
Response: 200 OK
  { "keys": [ { "kty": "RSA", "kid": "2024-05-A", "use": "sig", "n": "...", "e": "..." } ] }
```

- The API Gateway polls this endpoint every 5 minutes and caches the JWKS in an in-memory LRU. Downstream verification uses the `kid` header claim to select the correct public key.

#### Internal Library Interface (Node.js / Express middleware)

```javascript
// apiGateway middleware pseudo-signature
function authenticate(req, res, next) {
  // 1. Extract Bearer token from Authorization header.
  // 2. Verify RSA signature against cached JWKS.
  // 3. Validate 'exp', 'iat', 'sub' claims.
  // 4. Attach req.userId = payload.sub.
  // 5. Call next() or return 401/403.
}
```

---

### Data Owned

#### `users` collection (managed by `authService`)

| Field | Type | Constraints |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `email` | String | Unique, indexed, lower-cased |
| `passwordHash` | String | bcrypt hash (cost factor 12) |
| `createdAt` | Date | Immutable |
| `updatedAt` | Date | Updated on password changes |

#### `refreshTokens` collection (managed by `authService`)

| Field | Type | Constraints |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Indexed, foreign key to `users` |
| `tokenHash` | String | Unique, indexed (SHA-256 of opaque token) |
| `issuedAt` | Date | |
| `expiresAt` | Date | TTL index for automatic deletion |
| `revokedAt` | Date | Null until logout or reuse detection |
| `replacedByTokenHash` | String | Tracks rotation lineage |

- A **compound index** on `{ userId: 1, revokedAt: 1 }` supports efficient logout sweeps.
- A **TTL index** on `expiresAt` automatically purges stale refresh tokens, preventing unbounded growth.

---

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **MongoDB unavailability** | New registrations, logins, and refresh-token rotation fail with `503 Service Unavailable`. Existing API traffic continues because the Gateway verifies JWTs locally using the cached JWKS. | Circuit-breaker in `authService` MongoDB driver; Gateway JWKS cache tolerates authService outages up to the 5-minute poll window. |
| **Refresh-token replay** | An attacker re-uses a stolen refresh token. The rotation logic detects that the presented token was already consumed (`replacedByTokenHash` is set) and **revokes the entire token family** for that user, forcing re-authentication. | Store `replacedByTokenHash` atomically with a MongoDB transaction during rotation. |
| **Clock skew between Gateway and signer** | JWT `exp` or `nbf` rejections on valid tokens. | Gateway verifier allows a 60-second leeway on time-based claims. |
| **Bcrypt timing side-channel** | Login endpoint leaks whether an email exists through response-time variance. | Use `bcrypt.compare` on a dummy hash path even when the email is not found; keep response times statistically uniform. |
| **RSA private-key compromise** | Attacker can forge access tokens. | Maintain two `kid` keys in JWKS; rotate signing keys every 90 days and revoke old `kid` immediately on suspected compromise. Access tokens are short-lived (15 min), limiting the forgery window. |

---

### Scaling Considerations

- **Zero-auth-service lookups per API call**: Because the Gateway verifies JWTs with an in-memory public key, authenticated read/write traffic to `preferenceService` or `accountService` does not increase load on `authService` or MongoDB.
- **Horizontal scaling of `authService`**: The service is stateless; any instance can sign or verify refresh tokens because all token state lives in MongoDB.
- **MongoDB read-pressure**: Registration and login spikes generate writes to `users` and `refreshTokens`. If login volume exceeds single-replica write throughput, shard the `refreshTokens` collection by `userId` hash or offload reads to secondary replicas for non-critical analytics.
- **JWKS cache stampede**: On Gateway cold start, many instances may simultaneously request `/.well-known/jwks.json`. Mitigate with a short-lived startup cache file or staggered health-check initialization.

---

### Consequences

**Positive:**
- The API Gateway is entirely stateless, aligning with the Express.js horizontal-scaling model.
- Downstream services remain simple: they consume a trusted `userId` without implementing crypto.
- Token rotation and family revocation provide a usable compromise between security and UX.

**Negative / Trade-off:**
- Revocation of *access tokens* before natural expiry is impossible without introducing a distributed deny-list (Redis, etc.), which we explicitly avoid. The 15-minute expiry window is the only mitigation.
- Password resets, email verification, and multi-factor authentication are out of scope for this baseline architecture and must be addressed in a future ADR.

---

## Related Diagrams

- System overview and component relationships: `diagrams/string/iter1_overview.mmd`