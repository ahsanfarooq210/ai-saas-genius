# Auth Service

## Responsibilities

The Auth Service is the identity and access management backbone of the social media automation platform. Built with Node.js and Express, it centralizes all authentication concerns for both local users and third-party social platform integrations. Its specific responsibilities include:

- **Local Identity Lifecycle**: User registration with bcrypt-hashed credential storage, secure password verification at login, and enforcement of unique email-based identities.
- **JWT Token Management**: Generation and signing of short-lived access tokens (15-minute expiry) and long-lived refresh tokens (7-day expiry). It manages token rotation, maintains a revocation blocklist for logout/compromised sessions, and exposes token verification primitives for the API Gateway.
- **Social Media OAuth Orchestration**: Initiation and completion of OAuth 2.0 flows for external platforms (e.g., Facebook/Instagram Graph, Twitter/X API v2, LinkedIn, TikTok). This includes generating PKCE code challenges and CSRF-resistant `state` parameters, exchanging authorization codes for platform tokens, and delegating encrypted persistence of those tokens to the Token Store.
- **Session Context Provisioning**: Supplying authenticated user context—`userId`, `email`, and connected-platform metadata—to upstream consumers via validated JWT claims.
- **Connection Revocation**: Handling user-initiated disconnections by instructing the Token Store to purge stored OAuth credentials for a specific platform and invalidating any associated sessions.

## APIs / Interfaces

### External REST Endpoints (via API Gateway)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/auth/register` | Creates a local user account. Accepts `{ email, password }`. Returns `201` with `userId`. |
| `POST` | `/auth/login` | Verifies credentials. Accepts `{ email, password }`. Returns `{ accessToken, refreshToken }`. |
| `POST` | `/auth/refresh` | Issues a new access token and rotates the refresh token. Accepts `{ refreshToken }`. Blacklists the previous refresh token. |
| `POST` | `/auth/logout` | Revokes the presented refresh token and adds its `jti` to the JWT blocklist. |
| `GET`  | `/auth/oauth/:platform/connect` | Initiates a social connection flow. Query: `?redirectUri=...`. Returns `302` redirect to the platform’s authorization server. |
| `GET`  | `/auth/oauth/:platform/callback` | Handles the OAuth callback. Validates `state`, exchanges `code` for platform tokens, and calls the Token Store to persist them. Redirects the browser to the frontend with `?status=connected` or `?status=error`. |
| `DELETE` | `/auth/connections/:platform/:connectionId` | Requests deletion of platform tokens from the Token Store and removes the connection reference. |
| `GET`  | `/auth/connections` | Returns the list of active social platform connections for the authenticated user. |

### Internal Interfaces

- **Token Store Client**: An internal HTTP/JSON client that calls the Token Store to `upsertPlatformTokens(userId, platform, encryptedTokenPayload)` and `revokePlatformTokens(connectionId)`.
- **JWT Introspection (`POST /internal/auth/verify`)**: Consumed by the API Gateway to validate Bearer tokens and return normalized claims (`sub`, `email`, `scope`, `iat`, `exp`) without distributing cryptographic verification logic to the gateway.
- **MongoDB Native Driver / Mongoose**: Direct persistence of user records, refresh tokens, and ephemeral OAuth flow states.

## Data Ownership

The Auth Service owns and manages the following MongoDB collections:

- **`users`** — Core identity records.
  - `_id` (ObjectId)
  - `email` (unique, sparse index)
  - `passwordHash` (bcrypt or argon2)
  - `isEmailVerified` (Boolean)
  - `createdAt`, `updatedAt`

- **`refreshTokens`** — Long-lived session artifacts.
  - `userId` (indexed)
  - `tokenJti` (unique, indexed)
  - `hashedToken` (SHA-256 of the raw token value presented by the client)
  - `issuedAt`, `expiresAt` (TTL index on `expiresAt`)
  - `revoked` (Boolean, default `false`)
  - `ipAddress`, `userAgent` (audit metadata)

- **`oauthFlowStates`** — Ephemeral security context for in-flight OAuth handshakes.
  - `state` (unique, indexed)
  - `platform` (String, e.g., `instagram`, `twitter`, `linkedin`)
  - `userId` (ObjectId)
  - `pkceCodeChallenge` (String)
  - `redirectUri` (String)
  - `expiresAt` (Date, TTL index ~600 seconds)

- **`jwtBlocklist`** — Revoked token identifiers (used only if immediate revocation is required before natural expiry).
  - `jti` (unique, indexed)
  - `exp` (Date, TTL index for automatic document expiration)

> **Note**: OAuth access tokens, refresh tokens, and platform-specific credentials obtained from social networks are **not** stored by this service. They are delegated to the Token Store immediately after exchange.

## Failure Modes

| Failure | Impact | Mitigation / Recovery |
|---------|--------|----------------------|
| **MongoDB unavailability during login or registration** | Authentication and sign-up operations fail; API Gateway returns `503 Service Unavailable`. | Implement circuit breakers (e.g., `opossum`) on database calls. Fail fast and surface a generic error to prevent user enumeration. |
| **Refresh token reuse (theft indicator)** | A previously-used refresh token is presented again, suggesting token exfiltration. | Immediately revoke **all** refresh tokens belonging to the `userId` (token family invalidation) and force a password re-login. Alert the user via the Notification Service. |
| **OAuth state mismatch or expired flow state** | CSRF attack, replay attempt, or abandoned browser session. | Reject with `403 Forbidden`. Delete the stale `oauthFlowStates` document. Frontend must restart the connection flow. |
| **Platform token exchange network failure** | The user authorized the app on the platform side, but the Auth Service cannot exchange the authorization code for tokens. | Authorization codes are typically single-use and expire within 10 minutes. Do not blindly retry, as this invalidates the code. Return an error to the frontend and log the event for ops review. |
| **Token Store write failure after successful OAuth exchange** | The social platform considers the connection active, but the automation platform has no stored credentials to publish on behalf of the user. | Treat as a partial failure. Do not mark the connection as active in user-facing responses until the Token Store acknowledges persistence. Return an error redirect and prompt the user to retry. |
| **Event-loop blocking during password hashing** | Bulk registration traffic (attack or viral event) stalls the Node.js event loop, degrading all endpoints on the same pod. | Always use async `bcrypt`/`argon2` methods. If the cost factor exceeds 12, offload hashing to Node.js worker threads. |
| **Clock skew during JWT validation** | Services with desynchronized clocks reject valid tokens or accept expired ones. | Enforce NTP synchronization across all nodes. Include a small leeway (e.g., 60 seconds) in `exp`/`nbf` checks. |

## Scaling Considerations

- **Stateless Access Token Verification**: Access tokens are signed JWTs validated via an asymmetric public key (RS256). The Auth Service and API Gateway can verify these without querying MongoDB, enabling frictionless horizontal pod scaling and eliminating session affinity.
- **Refresh Token Partitioning**: In a sharded MongoDB deployment, shard the `refreshTokens` collection by `userId`. This keeps token rotation queries and family-revocation operations localized to a single shard.
- **TTL-Driven Cleanup**: Rely on MongoDB TTL indexes for `oauthFlowStates` and `refreshTokens` to prevent manual reaping jobs and control storage growth as user counts scale.
- **Rate Limiting**: Apply strict per-IP and per-email rate limits on `/auth/login` and `/auth/register` (e.g., 5 attempts per 15 minutes) using an in-memory sliding window or MongoDB-backed counters. This mitigates credential-stuffing and compute-DoS via password hashing.
- **OAuth Callback Throughput**: Callback handlers are I/O-bound (outbound HTTPS calls to platforms and Token Store writes). Keep these non-blocking with `async/await`. If traffic bursts exceed capacity, consider returning `202 Accepted` early and completing the exchange asynchronously, provided the frontend polls or uses Server-Sent Events for status.
- **Signing Key Rotation**: Store RS256 private keys in an external secret manager. Support zero-downtime rotation by publishing a JWKS endpoint (`GET /.well-known/jwks.json`) keyed by `kid`. The API Gateway should cache JWKS with a short TTL (e.g., 5 minutes) to pick up new keys rapidly.

## Related Diagrams

No paired component diagram is provided for this document. Refer to the system overview and authentication flow diagrams in the project documentation for broader architectural context.