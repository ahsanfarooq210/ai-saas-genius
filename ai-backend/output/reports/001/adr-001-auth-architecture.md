# ADR-001: Authentication and Authorization Architecture

## Status
Accepted

## Context
The social media automation platform must authenticate end-users, maintain secure sessions, and manage OAuth 2.0 credentials for multiple third-party platforms (e.g., Instagram, Twitter/X, LinkedIn, TikTok). The backend is built on Node.js and Express, with MongoDB as the primary database. Background jobs managed by Agenda.js will publish content on behalf of users, requiring secure, automated access to stored OAuth tokens without user interaction. We need an architecture that isolates credential storage, supports horizontal scaling, and minimizes the blast radius of a security breach.

## Decision
We will implement a two-tier authentication architecture:

1. **User Session Management**: The `auth_service` will manage user identity using email/password registration and JSON Web Tokens (JWT). Short-lived access tokens and long-lived refresh tokens provide stateless session management.
2. **Platform Credential Vault**: A dedicated `token_store` component will encrypt and store all third-party OAuth access and refresh tokens. It operates as a security boundary; no other service accesses MongoDB credential documents directly.

The `api_gateway` validates JWTs locally using an RS256 public key and routes authenticated requests. Background services (`platform_publisher`, `job_scheduler`) interact with `token_store` via an internal API authenticated by service API keys and mTLS.

---

### Auth Service

#### Responsibilities
- User registration and login with bcrypt-hashed passwords.
- JWT issuance (access tokens, 15-minute TTL) and refresh token rotation (7-day TTL, single-use).
- OAuth 2.0 authorization flow initiation and callback handling for connected social platforms.
- Refresh token revocation on logout or detected reuse.
- Public key distribution for JWT signature verification by downstream services.

#### APIs / Interfaces
| Endpoint | Method | Description |
|---|---|---|
| `/auth/register` | `POST` | Creates a user account. Body: `{ email, password }`. Returns user ID. |
| `/auth/login` | `POST` | Authenticates user. Body: `{ email, password }`. Returns `{ accessToken, refreshToken }`. |
| `/auth/refresh` | `POST` | Exchanges valid refresh token for a new access/refresh pair. Body: `{ refreshToken }`. |
| `/auth/logout` | `POST` | Revokes the provided refresh token family. |
| `/auth/oauth/:platform/initiate` | `GET` | Returns platform-specific OAuth URL with PKCE/state parameters. |
| `/auth/oauth/:platform/callback` | `POST` | Exchanges authorization code for platform tokens and delegates storage to `token_store`. |
| `/auth/me` | `GET` | Returns current user profile. Requires valid access token. |

Internal interface:
- `generateTokenPair(userId: string): { accessToken, refreshToken }`
- `verifyPassword(plain: string, hash: string): boolean`
- `revokeTokenFamily(familyId: string): Promise<void>`

#### Data Ownership
- **`users` collection**: `_id`, `email` (unique, indexed), `passwordHash`, `createdAt`, `updatedAt`.
- **`refresh_tokens` collection**: `jti` (JWT ID, unique, indexed), `userId`, `familyId` (token family for reuse detection), `hashedToken`, `expiresAt`, `revokedAt`, `createdAt`.

---

### Token Store

#### Responsibilities
- Encrypt OAuth access tokens, refresh tokens, and metadata at rest using AES-256-GCM.
- Decrypt and vend plaintext tokens to authorized internal services (`platform_publisher`) for API calls.
- Enforce per-user, per-platform token uniqueness constraints.
- Support token rotation when `platform_publisher` receives updated credentials from a platform.

#### APIs / Interfaces
Internal gRPC/HTTP interface (service-to-service only):
| Method | Input | Output |
|---|---|---|
| `storeToken` | `{ userId, platform, accessToken, refreshToken, scopes, expiresAt }` | `credentialId` |
| `getToken` | `{ userId, platform }` | `{ accessToken, refreshToken, scopes, expiresAt }` (decrypted) |
| `rotateToken` | `{ userId, platform, newAccessToken, newRefreshToken, newExpiresAt }` | `success` |
| `revokeToken` | `{ userId, platform }` | `success` |

Access is restricted by network policies and a static service API key header plus mTLS.

#### Data Ownership
- **`platform_credentials` collection**: `userId`, `platform`, `encryptedAccessToken` (ciphertext + IV + auth tag), `encryptedRefreshToken`, `scopes` (string array), `expiresAt`, `createdAt`, `updatedAt`.
- Compound unique index on `(userId, platform)`.

---

### API Gateway Integration
The `api_gateway` performs JWT validation on every incoming request (except `/auth/register`, `/auth/login`, `/auth/oauth/*` public initiation). It uses the RS256 public key (cached in memory, refreshed every 5 minutes) to verify the access token signature and extract `userId` and `roles`. The gateway injects `X-User-Id` and `X-User-Roles` headers into downstream requests. It does not interact with `auth_service` per request, avoiding a single point of contention.

---

### Security Model
- **Passwords**: bcrypt with cost factor 12.
- **JWTs**: RS256-signed. Private key held exclusively by `auth_service`. Public key available to `api_gateway`, `user_service`, and `job_scheduler`.
- **OAuth Tokens**: AES-256-GCM encryption with a 256-bit data encryption key (DEK) loaded from environment/KMS. Each record uses a unique 96-bit IV. Ciphertext format: `version:iv:authTag:ciphertext`.
- **Transport**: TLS 1.3 for all external and internal traffic.
- **Background Jobs**: `platform_publisher` authenticates to `token_store` using mTLS and a service account API key. User context is passed as `X-User-Id` but authorization is enforced by `token_store` (ensuring the requested `userId` matches the caller's service permissions and job ownership).

---

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **JWT access token expired** | User receives `401 Unauthorized`. | Client uses `/auth/refresh` with a valid refresh token. |
| **Refresh token reuse detected** | Potential token theft. | `auth_service` revokes the entire token family; user must re-authenticate with password. |
| **OAuth token expired before publish** | `platform_publisher` job fails. | `platform_publisher` attempts proactive refresh via platform APIs. If refresh fails, job retries with exponential backoff (max 3 attempts) then surfaces failure to `notification_service`. |
| **Encryption key compromised** | All stored OAuth tokens potentially exposed. | Key is externalized to a KMS; ciphertext includes key version for re-encryption without downtime. |
| **MongoDB unavailable** | Login, registration, and token retrieval blocked. | Services return `503 Service Unavailable`. API Gateway caches public keys locally, so existing JWT validation continues. |
| **Clock skew** | Valid tokens rejected or expired tokens accepted. | JWT validation allows 60-second leeway (`clockTolerance: 60`). |
| **Brute-force login** | Account takeover risk. | Rate limiting on `/auth/login` and `/auth/register` (100 requests per 15 minutes per IP, enforced by Redis). |

---

## Scaling Considerations

- **Statelessness**: Both `auth_service` and `token_store` are stateless. They can be scaled horizontally behind the API Gateway. No sticky sessions required.
- **Database Load**: 
  - `users.email` and `refresh_tokens.jti` are unique indexed fields to ensure fast lookups.
  - `platform_credentials` uses a compound index on `(userId, platform)`.
- **Cryptographic Overhead**: `token_store` is CPU-bound due to AES operations. In high-throughput scenarios, CPU-optimized instances or a dedicated worker pool should be used.
- **Public Key Caching**: API Gateway caches the RS256 public key to avoid querying `auth_service` on every request, reducing latency and load.
- **Rate Limiting**: Redis-backed sliding window counters for authentication endpoints to prevent abuse during traffic spikes.

---

## Consequences

**Positive:**
- Clear security boundary around OAuth credentials (`token_store`) limits exposure in case of a breach in the API or job layers.
- Stateless JWT validation at the gateway eliminates per-request auth service lookups, improving latency and availability.
- RS256 allows any internal service to verify tokens without sharing a symmetric secret.
- Token family reuse detection mitigates refresh token theft.

**Negative:**
- Introduces operational complexity: key rotation for JWT signing and AES encryption requires coordinated rollout.
- Background jobs cannot use user JWTs; they rely on service-to-service trust and internal API keys, which must be strictly rotated and monitored.
- Token revocation is eventually consistent; a revoked refresh token may remain valid until the in-memory/public-key cache TTL expires (mitigated by short access token TTL).

---

## Related Diagrams

- `diagrams/001/iter1_overview.mmd`
- `diagrams/001/iter1_auth-flow.mmd`
- `diagrams/001/iter1_component-auth-service.mmd`
- `diagrams/001/iter1_component-token-store.mmd`