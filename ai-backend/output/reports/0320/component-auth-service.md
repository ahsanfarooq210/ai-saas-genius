## Auth Service

The Auth Service is the trust boundary for the social media automation platform. It is responsible for authenticating local users, issuing and managing short-lived JWT access tokens and long-lived refresh tokens, and orchestrating OAuth 2.0 flows to link third-party social media accounts. It delegates the storage of sensitive OAuth credentials to the Token Vault and persists identity metadata, refresh token registries, and local credential hashes in MongoDB.

---

## Responsibilities

- **Local User Authentication**: Verify email/password credentials using bcrypt-hashed passwords stored in MongoDB.
- **JWT Lifecycle Management**: Issue asymmetrically or symmetrically signed access tokens (15-minute TTL) and opaque refresh tokens (7–30 day TTL); handle rotation, revocation, and family-wide invalidation on theft detection.
- **OAuth 2.0 Flow Orchestration**: Initiate authorization code flows with state nonces (and PKCE where supported) for Instagram, Twitter, Facebook, and other platforms; handle callback code exchange.
- **Social Account Linking/Unlinking**: Validate platform responses, extract account metadata, and register linked social identities while delegating encrypted token storage to the Token Vault.
- **Identity Resolution**: Provide user identity and linked-platform metadata to the API Gateway and downstream services (e.g., User Service).
- **Security Event Auditing**: Log authentication events (login success/failure, token refresh, OAuth grants, unlinking) for anomaly detection.

---

## APIs / Interfaces

### Internal REST Interface (API Gateway → Auth Service)

All endpoints are consumed internally by the API Gateway. They are not exposed directly to the public internet.

```http
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
GET    /v1/auth/verify
POST   /v1/auth/oauth/:platform/initiate
POST   /v1/auth/oauth/:platform/callback
DELETE /v1/auth/identities/:platform/:platformAccountId
GET    /v1/auth/identities
```

**Key behaviors:**
- `POST /v1/auth/login`: Returns an access JWT and a refresh token UUID. The refresh token record is immediately persisted to MongoDB with a SHA-256 hash of the requesting IP and user agent.
- `POST /v1/auth/oauth/:platform/initiate`: Generates a cryptographically random `state` nonce and, if applicable, a PKCE `code_verifier`. Stores the flow context in MongoDB with a 10-minute TTL, then returns the authorization URL to the API Gateway.
- `POST /v1/auth/oauth/:platform/callback`: Validates the `state` nonce against the MongoDB flow store, exchanges the authorization code with the platform, and pushes the resulting OAuth tokens into the Token Vault via an encrypted write. On success, creates a linked identity document in MongoDB containing only a `vaultEntryId` reference—not the token itself.
- `GET /v1/auth/verify`: Returns the decoded JWT claims and revocation status. Used by the API Gateway to enforce route-level authorization.

### External Dependencies

- **MongoDB**: Primary store for user credentials, refresh token registries, OAuth flow state transactions, and linked social account metadata.
- **Token Vault**: Write-only interface for persisting encrypted OAuth access/refresh tokens. The Auth Service retains only an opaque `vaultEntryId` returned by the vault.

---

## Data Owned

The Auth Service owns the following MongoDB collections:

- **`users_auth`**: Local authentication records.
  ```javascript
  {
    _id: ObjectId,
    email: "user@example.com",
    passwordHash: "$2b$12$...",      // bcrypt with cost factor 12
    passwordUpdatedAt: ISODate,
    mfaEnabled: false,
    createdAt: ISODate,
    updatedAt: ISODate
  }
  ```

- **`refresh_tokens`**: Refresh token registry enabling rotation and revocation.
  ```javascript
  {
    jti: "uuid-v4",
    userId: ObjectId,
    issuedAt: ISODate,
    expiresAt: ISODate,
    revoked: false,
    replacedBy: "uuid-v4",           // successor jti, or null
    familyId: "uuid-v4",             // links all tokens in a single grant chain
    ipHash: "sha256(...)",
    userAgentHash: "sha256(...)"
  }
  ```

- **`oauth_flows`**: Transient state for in-flight OAuth handshakes.
  ```javascript
  {
    state: "crypto-random-32-byte",
    platform: "instagram",
    userId: ObjectId,
    codeChallenge: "base64url(...)", // PKCE
    codeChallengeMethod: "S256",
    createdAt: ISODate,
    expiresAt: ISODate,              // TTL-indexed, 10 minutes
    consumed: false
  }
  ```

- **`linked_identities`**: Social account linkage metadata (token-less).
  ```javascript
  {
    userId: ObjectId,
    platform: "instagram",
    platformAccountId: "17841405793187218",
    platformUsername: "brand_handle",
    vaultEntryId: "vault-ref-abc",   // opaque pointer to Token Vault
    grantedScopes: ["instagram_basic", "instagram_content_publish"],
    linkedAt: ISODate,
    updatedAt: ISODate
  }
  ```

**Not owned**: Raw OAuth access tokens, refresh tokens, or platform API secrets. These are delegated to the Token Vault immediately upon receipt.

---

## Failure Modes

- **OAuth State/Nonce Replay or Expiry**: An attacker replays a stale callback or forges a state parameter. Mitigation: MongoDB enforces single-use `consumed` flags and a TTL index on `oauth_flows.expiresAt`. Callbacks with missing, mismatched, or already-consumed states are rejected with `403 Forbidden`.
- **Token Vault Write Asymmetry**: The OAuth code exchange with the platform succeeds, but the subsequent encrypted write to the Token Vault fails due to a network partition. The result is an orphaned platform grant. Mitigation: pre-flight vault health check; mark the linkage record `status: "pending_vault_write"` and retry with an idempotency key; surface a failure to the user rather than pretending success.
- **Refresh Token Replay (Theft)**: A stolen refresh token is used after it has already been rotated. Mitigation: on detecting reuse of a revoked token, the Auth Service immediately revokes the entire token family (`familyId`), forcing the user to re-authenticate with credentials.
- **Bcrypt Event-Loop Saturation**: High-volume login attempts block the Node.js event loop because bcrypt is CPU-intensive. Mitigation: enforce strict API Gateway rate limiting per IP and username; use async `bcrypt.compare` to offload to the libuv thread pool; scale horizontally before CPU thresholds exceed 70%.
- **MongoDB Auth Partition**: The refresh token collection becomes unreachable. Mitigation: access tokens are stateless JWTs verified via signature, so API traffic continues unaffected; login and refresh operations fail open with `503` and trigger circuit breakers to prevent cascading retry storms.
- **Platform OAuth Scope Reduction**: A user revokes permissions externally (e.g., via Instagram Settings), but the platform still returns a valid token with reduced scopes. Mitigation: the Platform Connector validates scopes before publishing; Auth Service records the originally granted scopes and supports forced re-linking flows.
- **Clock Skew JWT Rejection**: NTP drift between issuing and verifying services causes valid tokens to be rejected. Mitigation: configurable leeway of ±60 seconds on `exp` and `nbf` claims; standardize all services on UTC.

---

## Scaling Considerations

- **Stateless Access Token Verification**: Access JWTs are validated cryptographically without database lookups. This allows the Auth Service (and API Gateway JWT middleware) to scale horizontally with zero session affinity.
- **Refresh Token Write Load**: During peak traffic (e.g., mobile app opens), the `refresh_tokens` collection experiences bursty inserts. A compound index on `{ jti: 1 }` and `{ userId: 1, revoked: 1 }` is required. Use MongoDB TTL indexes to auto-purge expired tokens and prevent unbounded growth.
- **OAuth Flow Store Churn**: `oauth_flows` is a high-churn, short-TTL collection. Ensure the MongoDB WiredTiger cache can absorb the write throughput of transient state documents, or offload to Redis if flow volume exceeds 10,000 initiations per minute.
- **Token Vault Latency Budget**: The OAuth callback path is synchronous and blocks on the Token Vault write. The Auth Service must maintain a persistent HTTP/2 connection pool to the vault with keep-alive and a 2-second timeout. Vault must be deployed in the same availability zone to keep p99 latency under 10 ms.
- **Password Hashing Throughput**: Bcrypt cost factor of 12 yields ~250 ms per hash on target CPU. With a 4-thread libuv pool, theoretical throughput is ~16 logins/second per core. Scale pods horizontally based on CPU metrics; do not rely solely on request-rate autoscaling.
- **Sharding Strategy**: The `users_auth` collection uses a monotonically increasing ObjectId by default, which can create a hot shard for write-heavy signup events. Consider a hashed shard key on `_id` if user registration exceeds 1,000 signups per minute.
- **Secret Rotation**: JWT signing secrets must rotate without invalidating in-flight access tokens. The Auth Service supports key versioning via the `kid` header claim, keeping the previous key active for one TTL cycle (e.g., 15 minutes) after a new key is promoted.

---

## Related Diagrams

No paired component diagram was provided for this document.