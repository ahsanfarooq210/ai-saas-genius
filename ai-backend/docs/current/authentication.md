# Authentication

Live JWT authentication behavior for the FastAPI API.

If this document disagrees with the code, trust:

- `app/api/v1/endpoints/auth.py`
- `app/api/deps.py`
- `app/middleware/auth.py`
- `app/core/cookies.py`
- `app/api/v1/router.py`
- `app/main.py`

---

## Route Summary

| Method | Path | Auth required | Purpose |
|--------|------|---------------|---------|
| `POST` | `/api/v1/auth/signup` | No | Create a user; sets auth cookies and returns tokens in the body |
| `POST` | `/api/v1/auth/login` | No | Sign in an existing user; sets auth cookies and returns tokens in the body |
| `POST` | `/api/v1/auth/signin` | No | Alias of `login`; kept for compatibility |
| `POST` | `/api/v1/auth/refresh` | No (cookie or body) | Exchange a refresh token for a new token pair; sets new auth cookies |
| `POST` | `/api/v1/auth/logout` | No | Clears the auth cookies |
| `GET` | `/api/v1/auth/me` | Yes | Return the current authenticated user |

All non-auth `/api/v1/*` routes are protected by JWT middleware. For this service, that means `/api/v1/swarm/*` requires authentication.

`GET /health`, OpenAPI docs, and `/api/v1/auth/*` are public, except `/api/v1/auth/me`. "Public" here means the JWT middleware doesn't require a valid access token on that path — the CSRF check below still applies independently.

---

## Cookies (primary transport)

`signup`, `login`/`signin`, and `refresh` now set three cookies on the response, in addition to returning tokens in the JSON body:

| Cookie | HttpOnly | Secure | SameSite | Path | Max-Age |
|--------|----------|--------|----------|------|---------|
| `accessToken` | Yes | Yes (`COOKIE_SECURE`, default `true`) | `Lax` | `/` | `ACCESS_TOKEN_EXPIRE_MINUTES * 60` |
| `refreshToken` | Yes | Yes (`COOKIE_SECURE`) | `Strict` | `/api/v1/auth/refresh` | `REFRESH_TOKEN_EXPIRE_MINUTES * 60` |
| `csrfToken` | **No** | Yes (`COOKIE_SECURE`) | `Lax` | `/` | `ACCESS_TOKEN_EXPIRE_MINUTES * 60` |

Notes:

- `refreshToken` is scoped to `Path=/api/v1/auth/refresh` so it is never sent to any other route (including `/auth/logout` — logout cannot read it, it only clears it by name+path).
- `csrfToken` is intentionally **not** `HttpOnly`: the frontend must read it (`document.cookie`) and echo it back as the `X-CSRF-Token` header on state-changing requests. See "CSRF protection" below.
- `COOKIE_SECURE` defaults to `true`. Local HTTP-only dev must set `COOKIE_SECURE=false` in `.env` — browsers silently drop `Secure` cookies sent over plain HTTP, and refresh/logout/etc. will otherwise appear to "not work" locally.
- `CORS_ALLOWED_ORIGINS` (comma-separated) must list the exact frontend origin(s); wildcard `*` is not usable together with credentialed CORS.

**JSON body dual-mode:** `TokenResponse` (`access_token`, `refresh_token`, `token_type`) is still returned by `signup`/`login`/`signin`/`refresh` so existing bearer-header consumers keep working unchanged. Treat this as a migration window, not a long-term contract — once the frontend and any other clients read auth state from cookies only, drop the token fields from the response body. Suggested target: remove within one or two releases of the frontend cutover, once nothing reads `response.data.access_token` / `.refresh_token` anymore.

---

## Authenticate Requests

**Canonical precedence: `Authorization` header first, then the `accessToken` cookie.** This order was chosen because it's what the middleware already did before this change (`app/middleware/auth.py`), so no existing bearer-header client breaks. Browser clients that only rely on the cookie need send nothing extra for authentication itself (cookies are attached by the browser automatically) — see CSRF requirements for mutating requests.

```bash
curl http://localhost:8000/api/v1/swarm/graphs \
  -H "Authorization: Bearer <access-token>"
```

or, for a browser/cookie client, no header is needed as long as the `accessToken` cookie is present — the browser attaches it automatically.

---

## CSRF protection

Cookies are auto-attached by the browser, so state-changing requests need CSRF protection independent of the JWT check. This API uses the **double-submit cookie pattern**:

- On token issuance (`signup`, `login`, `signin`, `refresh`), a `csrfToken` cookie is set (`HttpOnly=false`, `Secure`, `SameSite=Lax`, `Path=/`).
- For any state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) the frontend must read `csrfToken` from `document.cookie` and send it back as the `X-CSRF-Token` header. The two values are compared with a constant-time check; a mismatch or missing header returns `403` with `{"detail": "CSRF token missing or invalid"}`.

The check is **skipped** when:

- The method is safe (`GET`/`HEAD`/`OPTIONS`/`TRACE`).
- The request carries an explicit `Authorization: Bearer <token>` header — a cross-site page cannot make the browser attach an arbitrary custom header, so bearer-header API clients (mobile apps, server-to-server, curl) are not exposed to CSRF and don't need to manage a CSRF token.
- Neither `accessToken` nor `refreshToken` cookie is present on the request (e.g. `signup`/first `signin`, before any cookie has ever been issued).

This runs for **every** path, including `/api/v1/auth/refresh` and `/api/v1/auth/logout` (both mutate state using cookies), not just JWT-protected routes.

Why double-submit instead of relying on `SameSite` alone: `accessToken` uses `SameSite=Lax`, which already blocks cross-site `fetch`/`XHR` POSTs from attaching the cookie in modern browsers, and would arguably be "good enough" on its own for this specific case (all mutations are POST/PUT/PATCH/DELETE via JS, not via plain HTML forms with GET). We're layering the double-submit cookie on top anyway because: (a) it protects against `SameSite` being dropped by an intermediate proxy or an older/misconfigured browser, (b) it doesn't rely on getting `SameSite=Strict` right on every future cookie, and (c) it's cheap to implement and doesn't burden bearer-header clients (the check is skipped for them). Treat `SameSite` as the first line of defense and the CSRF token as defense-in-depth, not the reverse.

---

## Logout

```bash
curl -X POST http://localhost:8000/api/v1/auth/logout \
  -H "X-CSRF-Token: <csrf-token-cookie-value>"
```

Clears `accessToken`, `refreshToken`, and `csrfToken` by sending `Set-Cookie` with `Max-Age=0` for each (matching the same `Path` each was originally set with).

**No server-side revocation yet.** There is no token blacklist/allowlist table in this codebase (checked: no such model/migration exists). This means:

- A previously-issued access token or refresh token, if captured via `Authorization` header instead of cookie (e.g. copied out of a mobile app's storage), remains valid until it naturally expires — logout does not invalidate it server-side.
- **Follow-up (not implemented):** add a revocation mechanism (e.g. a `revoked_refresh_tokens` table keyed by token `jti`, checked in `decode_token`/`_get_active_user`, or a short-lived access token + refresh-token-rotation-with-reuse-detection scheme) if server-side logout/revocation becomes a real requirement.

---

## Signup

```bash
curl -X POST http://localhost:8000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "valid-password",
    "full_name": "Example User"
  }'
```

Response body (also sets `accessToken`, `refreshToken`, `csrfToken` cookies):

```json
{
  "access_token": "<access-token>",
  "refresh_token": "<refresh-token>",
  "token_type": "bearer"
}
```

Failure cases:

| Status | Meaning |
|--------|---------|
| `409` | Email is already registered |
| `422` | Request body failed validation |

---

## Login

`/login` and `/signin` use the same handler. Prefer `/login` for new clients.

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "valid-password"
  }'
```

Response body (also sets `accessToken`, `refreshToken`, `csrfToken` cookies):

```json
{
  "access_token": "<access-token>",
  "refresh_token": "<refresh-token>",
  "token_type": "bearer"
}
```

Failure cases:

| Status | Meaning |
|--------|---------|
| `401` | Email/password is invalid |
| `403` | User exists but is inactive |
| `422` | Request body failed validation |

---

## Refresh Tokens

The refresh token can be supplied either way — an explicit body value takes precedence over the cookie:

```bash
# Cookie-only client (browser): body omitted entirely, refreshToken cookie sent automatically
curl -X POST http://localhost:8000/api/v1/auth/refresh \
  -H "X-CSRF-Token: <csrf-token-cookie-value>"

# Bearer-style client: explicit body, no CSRF header needed if no Authorization header/cookies are present
curl -X POST http://localhost:8000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<refresh-token>"}'
```

Response body (also sets fresh `accessToken`, `refreshToken`, `csrfToken` cookies):

```json
{
  "access_token": "<new-access-token>",
  "refresh_token": "<new-refresh-token>",
  "token_type": "bearer"
}
```

Access tokens are not accepted by `/refresh`; the supplied token must decode as a refresh token. If neither a body `refresh_token` nor a `refreshToken` cookie is present, the endpoint returns `401`.

---

## Current User

Use `/me` to verify that a token is valid and to fetch the authenticated user record.

```bash
curl http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer <access-token>"
```

Response:

```json
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "Example User",
  "is_active": true
}
```

---

## Protected Swarm Request Example

```bash
curl -X POST http://localhost:8000/api/v1/swarm/run \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "task_requirement": "Design a multi-tenant SaaS analytics platform",
    "thread_id": "thread-123"
  }'
```

Without a valid token, protected routes return:

```json
{
  "detail": "Not authenticated"
}
```

or:

```json
{
  "detail": "Could not validate credentials"
}
```

Both responses use HTTP `401` and include `WWW-Authenticate: Bearer`.

A cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` missing or mismatching `X-CSRF-Token` returns `403` with `{"detail": "CSRF token missing or invalid"}` instead.

---

## Configuration

JWT and cookie/CORS behavior is configured in `app/core/config.py`:

| Setting | Purpose |
|---------|---------|
| `JWT_SECRET_KEY` | Access-token signing secret |
| `JWT_REFRESH_SECRET_KEY` | Refresh-token signing secret |
| `JWT_ALGORITHM` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access-token lifetime; also `accessToken`/`csrfToken` cookie `Max-Age` |
| `REFRESH_TOKEN_EXPIRE_MINUTES` | Refresh-token lifetime; also `refreshToken` cookie `Max-Age` |
| `COOKIE_SECURE` | `Secure` flag on all three cookies; default `true`, set `false` for local plain-HTTP dev |
| `CORS_ALLOWED_ORIGINS` | Comma-separated exact frontend origin(s) allowed for credentialed CORS |

Use non-default secrets in any deployed environment.
