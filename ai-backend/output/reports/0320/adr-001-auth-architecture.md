## ADR-001: Authentication and Authorization Architecture

**Status:** Accepted  
**Scope:** Cross-cutting concern — end-user authentication, JWT session management, and OAuth 2.0 delegation for social media publishing.

### Context
The platform must authenticate users to a Node.js/Express REST API and securely act on their behalf across external social networks (Instagram, Twitter, Facebook, etc.). This requires two distinct trust domains: (1) password-based identity and JWT session management for our own API, and (2) OAuth 2.0 token lifecycle management for third-party platform access. Storing platform credentials in the primary MongoDB database was rejected due to compliance and blast-radius concerns.

### Decision
Adopt a **split-responsibility authentication model**:
- **`auth_service`** owns end-user identity, password verification, JWT issuance/rotation, and the OAuth linking ceremony.
- **`token_vault`** is the sole custodian of encrypted third-party OAuth tokens; no other service persists plaintext or raw OAuth secrets.
- **`api_gateway`** performs JWT validation at the edge, attaching user context before routing to downstream services.
- **`platform_connector`** retrieves decrypted tokens from the vault at job execution time and handles refresh logic.

---

### Responsibilities

**`auth_service`**
- User registration and login with bcrypt-hashed passwords (12 rounds).
- Issue asymmetrically signed access tokens (RS256 JWT, 15-minute expiry) and opaque refresh tokens.
- Initiate OAuth 2.0 authorization-code flows with PKCE and `state` CSRF protection for each supported platform.
- Complete OAuth callbacks, extract platform `accountId`, and pass encrypted tokens to `token_vault`.
- Maintain `linked_accounts` mappings between internal `userId` and external platform identities.

**`token_vault`**
- Encrypt OAuth access and refresh tokens at rest using AES-256-GCM with KMS-managed data encryption keys (envelope encryption).
- Expose a narrow internal API: `store(userId, platform, ciphertext)`, `retrieve(userId, platform)`, `revoke(userId, platform)`.
- Audit every decryption event; deny bulk export or plaintext query interfaces.

**`api_gateway`**
- Verify JWT signature and claims via middleware using the public key from `auth_service`.
- Reject expired, malformed, or missing tokens with `401`/`403` before request routing.
- Inject `X-User-Id` and `X-Scope` headers into proxied requests so downstream services (`user_service`, `scheduler_service`, etc.) do not re-validate tokens independently.

**`platform_connector`**
- Fetch decrypted OAuth tokens from `token_vault` when `scheduler_service` triggers a publish job.
- Proactively refresh tokens if expiry is within a configurable threshold (e.g., 5 minutes).
- Write refreshed tokens back to `token_vault` and update expiry metadata.

---

### APIs / Interfaces

**External (Client-facing REST)**
- `POST /auth/register` — Creates user via `user_service`; returns `201`.
- `POST /auth/login` — Validates bcrypt hash; returns `{ accessToken, refreshToken }`.
- `POST /auth/refresh` — Accepts opaque refresh token; rotates and returns new JWT pair.
- `POST /auth/logout` — Invalidates refresh token in MongoDB; client discards access token.
- `GET /auth/oauth/:platform` — Redirects browser to platform consent screen.
- `GET /auth/oauth/:platform/callback` — Exchanges code for tokens; stores encrypted credentials in `token_vault`.

**Internal (Service-to-Service)**
- `auth_service → mongodb`: Reads/writes `users` and `refresh_tokens` collections.
- `auth_service → token_vault`: `storeOAuthTokens(userId, platform, encryptedPayload)` after callback completion.
- `api_gateway → auth_service`: JWK endpoint for public key distribution; gateway caches keys locally.
- `platform_connector → token_vault`: `getOAuthTokens(userId, platform)` with decryption at the vault.
- `platform_connector → token_vault`: `updateOAuthTokens(userId, platform, encryptedPayload)` after token refresh.

---

### Data Ownership

| Data | Owner | Storage | Notes |
|------|-------|---------|-------|
| User credentials (bcrypt hashes) | `auth_service` | MongoDB `users` | Indexed by email; unique constraint |
| Refresh token metadata | `auth_service` | MongoDB `refresh_tokens` | Hashed token value; TTL index for cleanup |
| OAuth access/refresh tokens | `token_vault` | Encrypted blob store | Never stored in MongoDB; per-platform encryption contexts |
| Linked account mappings | `auth_service` | MongoDB `linked_accounts` | Stores `platform`, `accountId`, `vaultRef`, `status` |
| JWT public keys | `auth_service` | Shared read-only mount / JWK endpoint | Rotated independently of user data |

---

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| JWT signing key compromise | Forgeable tokens | RS256 key rotation every 90 days; short token expiry limits window |
| `token_vault` unavailable | Publishing jobs cannot retrieve OAuth tokens | Circuit breaker in `platform_connector`; Agenda.js exponential backoff retry in `scheduler_service` |
| OAuth token expired and refresh fails | Content cannot publish to platform | `platform_connector` marks `linked_accounts.status` as `disconnected`; `notification_service` alerts user to re-link |
| Brute-force / credential stuffing | Account takeover | `rate_limiter` enforces strict limits on `/auth/login` and `/auth/register` by IP and email |
| Clock skew across nodes | Valid JWTs rejected | NTP synchronization on all hosts; validation leeway of 60 seconds |
| MongoDB `users` outage | New logins/registrations blocked | Read replicas for authentication queries; cached JWKs allow existing JWTs to continue working |
| Replay of OAuth callback | Duplicate token storage or account linking | `auth_service` stores `state` nonce in MongoDB with a 10-minute TTL; callbacks are idempotent by `state` |

---

### Scaling Considerations

- **Stateless Edge Validation:** `api_gateway` validates JWTs locally using cached public keys; it does not call `auth_service` per request, allowing horizontal scaling with standard HTTP load balancers.
- **Token Vault Read Load:** Publishing peaks generate bursts of decryption requests. `platform_connector` workers should maintain a small, encrypted in-memory cache of tokens (TTL shorter than token lifetime) to reduce vault load, or `token_vault` should support read-replica decryption nodes.
- **Refresh Token Hygiene:** MongoDB `refresh_tokens` uses a TTL index to auto-expire stale documents, preventing unbounded collection growth.
- **OAuth State Cleanup:** The transient `state` nonces written to MongoDB during OAuth initiation use a TTL index; this prevents accumulation under high linking volume.
- **Job-Level Isolation:** `scheduler_service` runs `platform_connector` workers as independent Agenda.js jobs; each job authenticates to `token_vault` independently, avoiding shared token state that could leak across tenant boundaries.

---

### Related Diagrams

- `diagrams/0320/iter1_overview.mmd`
- `diagrams/0320/iter1_auth-flow.mmd`