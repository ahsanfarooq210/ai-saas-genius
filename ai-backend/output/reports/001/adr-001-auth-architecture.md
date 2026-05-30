# ADR-001: Authentication and Authorization Architecture

## Status
Accepted

## Context
The social media automation platform must authenticate end-users for web and mobile clients while also obtaining and maintaining OAuth 2.0 credentials for five external social platforms: Instagram, Twitter/X, Facebook, TikTok, and LinkedIn. The system needs to:
- Securely manage user sessions across stateless Node.js/Express API services.
- Protect long-lived third-party platform tokens at rest and in transit.
- Allow background workers (`agenda_worker`, `publisher_service`) to publish content on behalf of users without an interactive user login.
- Support account disconnection and token revocation initiated by either the user or the external platform.

A monolithic auth approach would couple password hashing, JWT lifecycle, OAuth handshakes, and encrypted secret storage into a single deployable unit, increasing the blast radius of security changes. We therefore decided to decompose these concerns into dedicated components.

## Decision
We will adopt a **decomposed, token-centric authentication architecture** with the following boundaries:

1. **API Gateway** enforces JWT validation on all inbound HTTP requests using RS256 asymmetric signing. It rejects unauthorized traffic before it reaches domain services.
2. **Auth Service** owns user identity verification (bcrypt password hashes), JWT issuance/refresh, and OAuth 2.0 authorization code flow initiation for social platforms.
3. **Token Store** is a dedicated encryption layer responsible only for persisting OAuth access tokens, refresh tokens, and expiry metadata in MongoDB. It exposes an internal API for encrypted write/read operations and abstracts key management.
4. **User Service** owns the `PlatformConnection` domain model (account IDs, usernames, connection status, posting preferences) but delegates credential storage to the Token Store via the Auth Service.
5. **Platform API Clients** retrieve decrypted OAuth tokens from the Token Store at runtime and inject them into outbound requests to Instagram, Twitter/X, Facebook, TikTok, and LinkedIn APIs.

## Responsibilities

### API Gateway
- Validate `Authorization: Bearer <JWT>` headers on every request.
- Terminate TLS and enforce CORS policies for web/mobile origins.
- Route authenticated requests to downstream services after appending `X-User-ID` and `X-Token-Expiry` headers.
- Apply rate limiting per IP and per user ID to mitigate brute-force and credential-stuffing attacks.

### Auth Service
- Register new users with bcrypt-hashed passwords stored in MongoDB.
- Authenticate users and issue short-lived access JWTs (15 minutes) and long-lived refresh JWTs (7 days) signed with RS256.
- Initiate platform OAuth flows: generate PKCE `code_verifier` and `state` parameters, redirect users to platform authorization endpoints, and handle callback routes (`/auth/callback/:platform`).
- Upon successful OAuth callback, extract platform tokens and pass them to the Token Store for encryption; then notify User Service to create a `PlatformConnection` record.
- Provide token refresh endpoints and logout/token revocation endpoints that invalidate refresh tokens in MongoDB.

### Token Store
- Accept plaintext OAuth tokens from Auth Service or Platform API Clients over an internal mTLS channel.
- Encrypt tokens using AES-256-GCM with per-connection data encryption keys (DEKs) managed by an internal key-derivation strategy; store ciphertext in MongoDB.
- Decrypt and return tokens on read, enforcing that only the `platform_api_clients` module and `auth_service` may invoke read operations.
- Handle token refresh orchestration for background jobs: when a platform access token is near expiry, the Token Store may use its stored refresh token to obtain a new access token before returning it to the caller.

### User Service
- Maintain the `User` profile and `PlatformConnection` documents in MongoDB, including platform-specific account handles, follower counts, and connection health status.
- Invoke Auth Service to validate session state when processing sensitive preference updates (e.g., changing posting frequency or target platforms).
- Mark connections as `disconnected` or `requires_reauth` when notified by Auth Service or Publisher Service of OAuth revocation.

### Platform API Clients
- Abstract platform-specific SDKs and HTTP semantics for Instagram Graph API, Twitter/X API v2, Facebook Graph API, TikTok Research/Content API, and LinkedIn REST API.
- Before each outbound request, fetch the current decrypted OAuth token from the Token Store using the `connectionId`.
- Normalize platform-specific error codes (e.g., Twitter 401, Instagram 190) into internal `PlatformAuthError` events that trigger re-authentication workflows.

## APIs and Interfaces

### External HTTP API (Auth Service)
| Endpoint | Method | Description |
|---|---|---|
| `/auth/register` | POST | Create user account; returns 201 with empty body. |
| `/auth/login` | POST | Validate credentials; returns `{ accessToken, refreshToken }`. |
| `/auth/refresh` | POST | Accepts `refreshToken`; returns new access/refresh pair and invalidates old refresh token (rotation). |
| `/auth/logout` | POST | Accepts `refreshToken`; blacklists it in MongoDB `revoked_tokens` collection. |
| `/auth/connect/:platform` | POST | Initiates OAuth flow; returns 302 redirect to platform authorize URL with `state` query param. |
| `/auth/callback/:platform` | GET | Validates `state` and `code`; exchanges code for platform tokens; stores via Token Store; redirects to client success URI. |
| `/auth/connections/:connectionId` | DELETE | Revokes platform tokens via platform API and deletes encrypted store entry. |

### Internal Service Interfaces
**Auth Service → Token Store**
```javascript
// gRPC or internal HTTP (mTLS)
message StoreOAuthTokens {
  string userId = 1;
  string platform = 2;
  string connectionId = 3;
  string accessToken = 4;
  string refreshToken = 5;
  int64 expiresAt = 6;
}
rpc StoreTokens(StoreOAuthTokens) returns (StoreResult);

message RetrieveRequest {
  string connectionId = 1;
}
rpc RetrieveTokens(RetrieveRequest) returns (DecryptedTokenBundle);
```

**Platform API Clients → Token Store**
```javascript
// Synchronous call before every publish batch
rpc RetrieveTokens(RetrieveRequest) returns (DecryptedTokenBundle);
```

**API Gateway → Downstream Services**
- `X-User-ID`: extracted from JWT `sub` claim.
- `X-Scope`: extracted from JWT `scope` claim (e.g., `user`, `admin`).
- `X-Request-ID`: generated per request for tracing.

## Data Ownership

| Component | Collection / Store | Contents |
|---|---|---|
| **Auth Service** | `mongodb.users` | User UUID, bcrypt password hash, email verification status, MFA enrollment flags. |
| **Auth Service** | `mongodb.revoked_tokens` | JTI (JWT ID) and expiry of revoked refresh tokens for logout. |
| **Auth Service** | `mongodb.oauth_state` | Ephemeral PKCE `code_challenge`, `state` nonce, and `createdAt` for OAuth callbacks (TTL 10 min). |
| **Token Store** | `mongodb.encrypted_credentials` | Ciphertext of access/refresh tokens, IV, auth tag, DEK reference, `connectionId`, `platform`, `expiresAt`. |
| **Token Store** | Runtime only | Master key or KMS credentials (never persisted in MongoDB). |
| **User Service** | `mongodb.platform_connections` | Connection UUID, userId, platform enum, platform account ID, username, connection status (`active`, `expired`, `revoked`), preference references. |

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **JWT signing key compromise** | Attacker can forge session tokens. | RS256 key pair with quarterly rotation; old public keys retained in JWKS endpoint for token validation until expiry. |
| **Refresh token theft** | Persistent unauthorized access. | Refresh token rotation on every use; binding to `jti` in `revoked_tokens` collection; detect reuse and revoke entire family. |
| **Token Store decryption failure / KMS outage** | Background jobs cannot publish; new OAuth connections fail. | Circuit breaker in Platform API Clients falls back to stale cached tokens (encrypted in-memory, 5-min TTL) if available; alert on-call engineer. |
| **Platform revokes app access** | Publisher Service receives 401/403 on publish. | Platform API Clients emit `PlatformAuthError.Revoked` event; Notification Service alerts user; User Service marks connection `requires_reauth`. |
| **OAuth `state` parameter mismatch or replay** | CSRF or session fixation during platform connection. | `state` values are cryptographically random, single-use, and stored in MongoDB `oauth_state` with a 10-minute TTL index. |
| **Clock skew across API Gateway instances** | JWT `exp`/`nbf` validation failures. | All nodes synchronized via NTP; Gateway allows 30-second leeway in `nbf` checks. |
| **MongoDB replica set partition** | Auth Service cannot verify passwords or issue tokens; Token Store cannot read/write credentials. | Driver-level retry with exponential backoff; read preferences for `users` collection use `primaryPreferred` to avoid stale reads during fail-over. |

## Scaling Considerations

- **API Gateway JWT Validation**: Stateless operation allows horizontal scaling behind a load balancer. The RS256 public key is cached in-memory with a 5-minute TTL to avoid repeated JWKS fetches.
- **Auth Service Horizontal Scaling**: The service is stateless between requests; OAuth `state` and PKCE data live in MongoDB (not memory), so any instance can handle a callback.
- **Token Store Throughput**: Encryption/decryption is CPU-bound but low-latency (<5ms). For high throughput, deploy Token Store instances on CPU-optimized nodes and maintain a MongoDB connection pool sized at `2 * CPU cores` per instance.
- **Background Job Token Access**: `agenda_worker` → `publisher_service` → `platform_api_clients` → `token_store` path must handle burst traffic when thousands of jobs trigger at the same posting window. Token Store supports bulk retrieval (`RetrieveMany`) to reduce round-trips.
- **Database Load**: MongoDB `encrypted_credentials` collection uses a compound index on `{ connectionId: 1, platform: 1 }` to serve Token Store lookups in <10ms at scale.

## Consequences

### Positive
- **Security isolation**: OAuth secrets never traverse the public API layer; they remain encrypted and accessible only to the Token Store and Platform API Clients.
- **Independent scaling**: Token Store can be scaled and audited independently from user-facing login flows.
- **Platform abstraction**: Platform API Clients normalize five different OAuth implementations, reducing complexity in Publisher Service.
- **Auditability**: Every token store read/write and every OAuth callback is logged with `X-Request-ID` for traceability.

### Negative
- **Operational complexity**: Three components (Auth Service, Token Store, Platform API Clients) must be coordinated for a single platform connection.
- **Latency overhead**: Publishing requires a synchronous lookup to the Token Store and decryption step, adding ~10–20ms per batch.
- **Key management burden**: The Token Store introduces a secrets-management requirement (KMS or HSM) that would not exist if tokens were stored in plaintext by a monolith.

### Risks
- If the Token Store encryption key is lost without a backup, all stored OAuth tokens become permanently undecryptable, forcing every user to reconnect all social accounts.
- Platform API Clients must be updated rapidly when external APIs deprecate OAuth scopes or token formats (e.g., Twitter/X API migrations).

## Related Diagrams
- `diagrams/001/iter1_overview.mmd`
- `diagrams/001/iter1_auth-flow.mmd`