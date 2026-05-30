# ADR-001: Authentication and Authorization Architecture

## Status
Accepted

## Context
The social media automation platform must authenticate end-users, maintain secure sessions for web and mobile clients, and store encrypted credentials for third-party social platform APIs (Twitter/X, Instagram, Facebook, LinkedIn). The auth architecture must minimize lateral movement risks if a service is compromised and support horizontal scaling without session affinity.

## Decision
Adopt a stateless JWT-based authentication layer for user sessions, managed by the `auth_service`. Use a dedicated `token_store` service with field-level encryption to persist OAuth 2.0 access and refresh tokens for connected social platforms. The `api_gateway` performs JWT validation at the edge before routing to downstream services. Internal service-to-service calls within the cluster rely on network segmentation and mTLS, with sensitive operations requiring user-context propagation via signed JWT claims.

## Responsibilities

### User Identity and Session Management
- **auth_service**: Handles user registration, password validation, login/logout, JWT issuance, and refresh token rotation. It owns the user identity collection in MongoDB.
- **api_gateway**: Validates JWT signatures and expiry on every incoming request, rejects unauthorized traffic at the edge, and injects a normalized `X-User-Context` header into proxied requests.

### Platform Credential Lifecycle
- **auth_service**: Orchestrates OAuth 2.0 authorization code flows with PKCE (where supported) for each social platform. Exchanges codes for platform tokens and delegates secure storage to `token_store`.
- **token_store**: Encrypts OAuth access tokens, refresh tokens, and token metadata (scopes, expiry) using AES-256-GCM before writing to MongoDB. Decrypts and returns plaintext tokens only to authorized internal services (`publisher_service`, `auth_service` for refresh).
- **publisher_service**: Retrieves decrypted platform tokens from `token_store` at execution time to perform publishing API calls.

### Authorization Boundaries
- **user_service**: Enforces ownership checks on user profiles and posting preferences. It trusts the `X-User-Context` header from the gateway but does not re-validate the JWT signature.
- **scheduler_service** and **content_service**: Operate on user-scoped resources; they extract `userId` from the request context to query MongoDB.

## APIs and Interfaces

### External Interfaces
- `POST /api/v1/auth/register` — Creates a local user account. Accepts email, password, and optional profile data. Returns a short-lived access JWT (15-minute TTL) and a long-lived refresh JWT (stored in an `httpOnly` cookie).
- `POST /api/v1/auth/login` — Authenticates credentials and returns the same token pair.
- `POST /api/v1/auth/refresh` — Accepts a refresh JWT and issues a new access JWT. Refresh tokens are single-use and rotated on every exchange.
- `POST /api/v1/auth/logout` — Invalidates the current refresh token by adding its `jti` to a blocklist in MongoDB (TTL-indexed).
- `GET /api/v1/auth/oauth/:platform/start` — Initiates platform OAuth flow. Returns a redirect URL with a state parameter bound to the current user session.
- `GET /api/v1/auth/oauth/:platform/callback` — Receives the authorization code, exchanges it for platform tokens, and stores them via `token_store`.

### Internal Interfaces
- `auth_service` → `token_store`: gRPC/HTTP interface `StorePlatformTokens(userId, platform, encryptedPayload, metadata)`. The payload is encrypted by `token_store` itself to ensure the encryption key never leaves the service boundary.
- `publisher_service` → `token_store`: gRPC/HTTP interface `GetPlatformTokens(userId, platform)`. Returns decrypted tokens or a 404 if none exist.
- `auth_service` → `mongodb`: Stores user credentials (bcrypt-hashed passwords), refresh token blocklist, and OAuth state/nonces.
- `api_gateway` → `auth_service`: Optional introspection endpoint for JWT validation if the gateway cannot verify signatures locally (e.g., using a JWKS endpoint `GET /.well-known/jwks.json` hosted by `auth_service`).

## Data Ownership

| Data Entity | Owner | Storage | Notes |
|---|---|---|---|
| User identity (email, bcrypt hash) | auth_service | MongoDB | Hashed with bcrypt cost factor 12+ |
| Refresh token blocklist (jti, exp) | auth_service | MongoDB | TTL index auto-expires entries |
| OAuth state/nonces | auth_service | MongoDB | Short-lived (5-minute TTL) |
| Platform OAuth tokens (encrypted) | token_store | MongoDB | AES-256-GCM, unique data encryption key (DEK) per user/platform |
| Platform token metadata (scopes, expiry) | token_store | MongoDB | Stored alongside ciphertext for querying without decryption |
| User profiles & preferences | user_service | MongoDB | Contains foreign key reference to auth_service userId |

## Failure Modes

### JWT Compromise or Leak
- **Impact**: Attacker can impersonate a user until token expiry.
- **Mitigation**: Access tokens have a short TTL (15 minutes). Refresh tokens are bound to device/session fingerprints where possible. The refresh token blocklist allows rapid revocation.

### token_store Breach
- **Impact**: Encrypted tokens are exposed.
- **Mitigation**: Encryption keys are managed via a separate key management service or environment secret and are not stored in MongoDB. An attacker with database access but without the DEK cannot decrypt tokens.

### OAuth Token Expiry Mid-Flight
- **Impact**: A scheduled publish job fails because the platform token expired and refresh failed.
- **Mitigation**: `publisher_service` catches 401 errors from platform APIs, signals `auth_service` to refresh the token via `token_store`, and retries the publish once. If refresh fails, the job is marked failed and the user is notified to re-authenticate the platform.

### auth_service Unavailability
- **Impact**: New logins, registrations, and token refreshes fail. Existing valid access JWTs continue to work because the gateway validates them locally using JWKS.
- **Mitigation**: The JWKS endpoint is cached by the gateway. User-scoped operations (posting, scheduling) that only require `userId` from the JWT continue to function during an `auth_service` outage.

### Clock Skew / JWT Expiry Edge Cases
- **Impact**: Valid tokens rejected or expired tokens accepted due to clock drift.
- **Mitigation**: Allow a small leeway (60 seconds) in JWT `exp` and `nbf` validation. Synchronize server clocks with NTP.

## Scaling Considerations

### Stateless JWT Validation at the Gateway
- The `api_gateway` validates JWTs using a locally cached JWKS. This avoids hitting `auth_service` on every request, allowing the gateway and all downstream services to scale horizontally without session affinity.

### token_store Isolation
- `token_store` is a dedicated service to allow independent scaling of cryptographic operations. CPU-intensive encryption/decryption can be vertically scaled or replicated behind a load balancer without affecting `auth_service` throughput.

### Refresh Token Rotation Load
- During peak login activity, refresh token rotation generates write load on MongoDB. The blocklist collection uses a TTL index to keep the working set small. For very high scale, the blocklist can be moved to Redis.

### OAuth Flow State Management
- OAuth state parameters are stored in MongoDB with a 5-minute TTL. This collection sees burst traffic during "connect account" campaigns but is otherwise cold. No special sharding is required at launch.

## Related Diagrams

- `diagrams/0350/iter1_overview.mmd`
- `diagrams/0350/iter1_auth-flow.mmd`
- `diagrams/0350/iter1_component-auth-service.mmd`
- `diagrams/0350/iter1_component-token-store.mmd`