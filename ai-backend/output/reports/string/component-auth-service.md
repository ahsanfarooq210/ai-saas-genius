## Auth Service

## Overview

The `authService` is a Node.js domain module responsible for identity and access management within the social media automation platform. It handles user registration, credential verification, and stateless session management using JSON Web Tokens (JWT). The service persists only core user identity records to `mongoDB` and exposes route handlers and middleware consumed by the `apiGateway`. It does not manage social platform OAuth tokens (owned by `accountService`) or posting preferences (owned by `preferenceService`).

## Responsibilities

- **User Registration**: Accept email/password payloads, enforce password complexity rules, asynchronously hash passwords using bcrypt, and persist user identity records to MongoDB with unique email enforcement.
- **Credential Authentication**: Verify plaintext passwords against stored bcrypt hashes using constant-time comparison to prevent timing attacks.
- **JWT Issuance**: Sign and issue short-lived access tokens (e.g., 15-minute expiry) and long-lived opaque refresh tokens (e.g., 7-day expiry). Access tokens use HS256 or RS256 and contain minimal claims: `userId`, `email`, `iat`, `exp`, and `iss`.
- **Token Validation**: Verify JWT signatures, issuer claims, and expiration on every request. Expose validation logic as Express middleware for the `apiGateway` to protect downstream routes.
- **Token Refresh**: Accept valid refresh tokens, verify their hashes against the `mongoDB` record, issue a new access/refresh pair, and replace the stored refresh token hash. Detect reuse attempts to mitigate token theft.
- **Logout & Revocation**: Remove the stored refresh token hash from the database, ensuring the token cannot be used again to obtain new access tokens.
- **Request Context Injection**: Upon successful validation, attach the decoded `userId` and `email` to the Express `req.user` object so downstream services can scope all queries to the authenticated user.

## APIs & Interfaces

### Public REST Endpoints (mounted by `apiGateway`)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/auth/register` | Creates a new user. Request body: `{ email: string, password: string }`. Returns `201 Created` with `{ userId, email }`. |
| `POST` | `/auth/login` | Authenticates an existing user. Returns `200 OK` with `{ accessToken: string, refreshToken: string }`. |
| `POST` | `/auth/refresh` | Rotates credentials. Body: `{ refreshToken: string }`. Returns new access and refresh tokens. |
| `POST` | `/auth/logout` | Revokes the current refresh token. Body: `{ refreshToken: string }`. Returns `204 No Content`. |
| `GET` | `/auth/me` | Returns the current authenticated user's identity. Header: `Authorization: Bearer <accessToken>`. Returns `{ userId, email }`. |

### Internal Middleware Interface

Exported programmatic interface for the `apiGateway` to protect routes before forwarding to `preferenceService`, `accountService`, or `jobScheduler`.

```javascript
// validateAccessToken.ts
export async function validateAccessToken(token: string): Promise<<{
  userId: string;
  email: string;
  iat: number;
  exp: number;
}>;

// requireAuth.ts (Express middleware)
export function requireAuth(req: Request, res: Response, next: NextFunction): void;
```

- `requireAuth` reads the `Authorization: Bearer <token>` header, calls `validateAccessToken`, and attaches `req.user`.
- On failure, it responds with `401 Unauthorized` and a `WWW-Authenticate: Bearer` header.

### Database Model Interface

```javascript
// Mongoose schema for the 'users' collection
const userSchema = new Schema({
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  refreshTokenHash: { type: String, default: null, index: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
```

## Data Ownership

The `authService` exclusively owns the **`users`** collection in MongoDB.

Fields under its ownership:
- `email`: Unique, indexed lookup key for login and uniqueness enforcement.
- `passwordHash`: Asynchronous bcrypt hash of the plaintext password. Plaintext is never persisted.
- `refreshTokenHash`: SHA-256 hash of the active opaque refresh token, enabling explicit logout and reuse detection.
- `createdAt` / `updatedAt`: Audit timestamps for identity lifecycle tracking.

**Explicitly not owned by this service**:
- Social platform OAuth tokens and connection state (`accountService` owns the `accounts` / `oauth_tokens` collection).
- Posting schedules, captions, hashtags, and media-type rules (`preferenceService` owns the `preferences` collection).
- Uploaded photos and videos (`mediaStorage`).

## Failure Modes & Mitigations

| Failure Mode | Impact | Mitigation |
|--------------|--------|------------|
| **Duplicate email registration** | MongoDB unique index violation on `email`. | Catch `MongoError` code `11000`; return `409 Conflict`. Do not expose raw database errors. |
| **Invalid credentials** | Brute-force or mistaken login attempt. | Return uniform `401 Unauthorized` for both non-existent emails and password mismatches. Use bcrypt async compare to yield the event loop and prevent timing-based user enumeration. |
| **MongoDB unavailable** | All registration, login, and refresh operations fail. | Configure Mongoose with `bufferCommands: false` for auth mutations to fail fast. Return `503 Service Unavailable`. |
| **JWT secret/key rotation** | Existing access tokens become invalid immediately. | Keep access-token TTL short (≤ 15 minutes). Rotation is absorbed naturally; clients use `/auth/refresh` to recover without password re-entry. |
| **Refresh token reuse / theft** | Malicious actor uses a stolen refresh token. | Store only one active refresh token hash per user. On reuse detection (presented hash does not match stored hash), immediately wipe `refreshTokenHash` and force password re-authentication. |
| **Timing attacks on login** | Attacker infers valid emails via response latency. | Ensure the code path for non-existent users executes a dummy bcrypt compare against a static dummy hash to maintain constant-time response latency. |
| **Token expiry / clock skew** | Legitimate requests rejected due to `exp` claim. | Clients must proactively refresh. Server allows a small leeway (e.g., 60 seconds) during validation and returns `401` with `error: "token_expired"` to trigger refresh. |
| **Credential stuffing** | High-volume automated login attempts. | `apiGateway` must enforce rate limiting (e.g., 5 attempts per IP per minute) before traffic reaches `authService`. The auth service itself remains stateless. |

## Scaling Considerations

- **Stateless JWT Validation**: Access token verification is cryptographic and requires no database round-trip. This allows the `apiGateway` to validate requests at the edge, enabling horizontal scaling of gateway instances without session affinity.
- **CPU-Intensive Hashing**: bcrypt password hashing consumes significant CPU cycles on Node.js’s event loop. Under bursty registration/login load:
  - Use asynchronous bcrypt methods (`bcrypt.hash` / `bcrypt.compare`) which delegate to the libuv thread pool.
  - Tune `BCRYPT_ROUNDS` (recommended: 12) to balance security with throughput. If sustained registration volume exceeds single-core capacity, reduce rounds or offload hashing to a worker thread pool.
- **Database Read Patterns**: Login and refresh operations rely on indexed lookups by `email` and `refreshTokenHash`. Ensure the MongoDB working set includes these indexes. The `refreshTokenHash` index should remain sparse because not all users maintain an active session.
- **Bounded Refresh Token Writes**: Each user has at most one stored refresh token hash. Refresh rotation generates a single document update per user session, keeping write pressure low and predictable regardless of request volume.
- **Minimal Token Payload**: JWTs contain only `userId`, `email`, `iat`, `exp`, and `iss`. Avoid embedding platform preferences, media lists, or account metadata to prevent header bloat and simplify token rotation.
- **Secret Management**: Load `JWT_SECRET` (or RS256 private key) from environment variables or a secrets manager at startup. Support zero-downtime key rotation by accepting a transition array of valid signing keys during brief rotation windows.