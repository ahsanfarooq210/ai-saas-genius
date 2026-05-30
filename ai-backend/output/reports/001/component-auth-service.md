# Auth Service

## Responsibilities

- **User Authentication**: Verify local credentials (email/password) and issue session tokens.
- **JWT Lifecycle Management**: Generate, sign, validate, and rotate access and refresh tokens using RS256 or HS256 algorithms.
- **OAuth 2.0 Orchestration**: Initiate and complete authorization code flows with PKCE for Instagram, Twitter/X, Facebook, TikTok, and LinkedIn.
- **Token Handoff**: Exchange platform authorization codes for access/refresh tokens and persist the encrypted results via the Token Store.
- **Credential Security**: Hash passwords using bcrypt (cost factor 12) and enforce password complexity rules.
- **Cross-Service Identity Verification**: Expose an internal token introspection endpoint consumed by the API Gateway and User Service to resolve JWTs to user identities without direct database coupling.

## APIs and Interfaces

### Public HTTP Endpoints (Express.js)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Create a local user account; returns `user_id`. |
| `POST` | `/auth/login` | Validate credentials; returns JWT access token and refresh token. |
| `POST` | `/auth/logout` | Revoke the caller’s refresh token and add the access token `jti` to the blocklist. |
| `POST` | `/auth/refresh` | Exchange a valid refresh token for a new access/refresh token pair. |
| `GET`  | `/auth/oauth/:platform/authorize` | Redirect the client to the platform’s consent screen with a generated `state` and PKCE `code_challenge`. |
| `GET`  | `/auth/oauth/:platform/callback` | Validate `state`, exchange the authorization code for platform tokens, and store them via Token Store. |
| `DELETE` | `/auth/oauth/:platform` | Revoke the platform connection and instruct Token Store to delete associated tokens. |

### Internal Interfaces

- **`POST /internal/auth/verify`**  
  Accepts a JWT access token and returns normalized claims (`user_id`, `email`, `scopes`, `iat`, `exp`) to the API Gateway and User Service. Returns `401` if the token is expired, malformed, or blocklisted.

- **Token Store Client**  
  - `storePlatformTokens(userId, platform, tokenPayload)` — Persists encrypted OAuth tokens after a successful callback.  
  - `revokePlatformTokens(userId, platform)` — Deletes tokens upon user disconnect or security event.

## Data Ownership

All data resides in MongoDB unless otherwise noted.

- **`users` collection (authentication subset)**  
  - `email` (unique index)  
  - `password_hash` (bcrypt)  
  - `email_verified` (boolean)  
  - `auth_method` (`local` or `oauth_<platform>`)  
  - `created_at`, `updated_at`

- **`refresh_tokens` collection**  
  - `token_hash` (SHA-256 of the opaque refresh token)  
  - `user_id` (indexed)  
  - `issued_at`, `expires_at`  
  - `rotated_to` (reference to the next token in the rotation chain, or `null`)  
  - `revoked` (boolean)

- **`oauth_states` collection** (ephemeral)  
  - `state` (random 128-byte string, unique index)  
  - `code_verifier` (PKCE secret)  
  - `platform`, `user_id`, `redirect_uri`  
  - `expires_at` (TTL index, 10 minutes)

- **`token_blocklist` collection**  
  - `jti` (JWT ID, unique index)  
  - `exp` (TTL index matching the original token expiry)

- **`jwt_keys` collection**  
  - `kid` (key ID)  
  - `private_key` (encrypted at rest, only used on signing instances)  
  - `public_key`  
  - `active` (boolean), `created_at`, `retired_at`

## Failure Modes

- **MongoDB Unavailability**: Login, registration, and refresh operations fail closed with HTTP `503`. Stateless JWT verification (`/internal/auth/verify`) continues to function as long as the signing public key is cached in memory, preserving API Gateway request flow.
- **Token Store Unreachable During OAuth Callback**: After exchanging the authorization code with the platform, the service receives tokens but cannot persist them. The handler retries with exponential backoff up to 3 times. Persistent failure returns HTTP `502` to the client and logs the platform token response metadata (with tokens redacted) for manual reconciliation.
- **OAuth State / PKCE Mismatch**: Callbacks presenting an unknown, expired, or mismatched `state` parameter are rejected with HTTP `403` and the authorization code is discarded immediately to prevent CSRF and authorization code injection attacks.
- **Refresh Token Replay**: If a refresh token that has already been used is presented, the system detects the break in the rotation chain, revokes the entire chain for that user, and forces re-authentication.
- **JWT Key Rotation Lag**: If a signing key is retired and purged before all issued access tokens expire, valid user requests will fail validation. Mitigation: maintain a 48-hour overlap window where retired keys remain available for verification but are no longer used for signing.
- **Event Loop Blocking**: Synchronous bcrypt comparisons or JWT signing under load can stall the Node.js event loop. The service uses async bcrypt APIs and offloads RS256 signing to a `worker_threads` pool when request latency exceeds 50 ms.

## Scaling Considerations

- **Horizontal Scaling**: JWT validation is stateless; service instances scale arbitrarily behind the API Gateway load balancer without sticky sessions.
- **OAuth State Distribution**: Because `oauth_states` are persisted in MongoDB rather than local memory, the callback request from the social platform may land on any instance, eliminating the need for session affinity during OAuth flows.
- **Read Replica Offload**: High-volume token verification from the API Gateway generates large read traffic on the `users` and `jwt_keys` collections. Deploy MongoDB read replicas and configure the Auth Service to perform non-critical reads (e.g., `email_verified` checks) against secondaries.
- **Rate Limiting**: Enforce per-IP rate limits on `/auth/login` (5 requests/minute) and per-user limits on OAuth initiation (3 attempts/hour per platform) using in-memory token buckets backed by MongoDB counters to prevent brute force and consent-screen abuse.
- **Token Blocklist Hygiene**: With short access-token TTL (5 minutes), the `token_blocklist` remains small. If logout volume grows, shard the collection by `jti` prefix or replace MongoDB blocklist checks with an in-process LRU cache refreshed from the database every 30 seconds.
- **Credential Hashing Throughput**: Account registration spikes (e.g., marketing campaigns) increase CPU load from bcrypt. Cap concurrent hashing operations to 10 per instance and return HTTP `429` when the worker thread pool queue depth exceeds 50.

## Related Diagrams

No paired diagram provided for this component.