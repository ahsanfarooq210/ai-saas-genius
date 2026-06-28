# Authentication

Live JWT authentication behavior for the FastAPI API.

If this document disagrees with the code, trust:

- `app/api/v1/endpoints/auth.py`
- `app/api/deps.py`
- `app/middleware/auth.py`
- `app/api/v1/router.py`

---

## Route Summary

| Method | Path | Auth required | Purpose |
|--------|------|---------------|---------|
| `POST` | `/api/v1/auth/signup` | No | Create a user and return JWT tokens |
| `POST` | `/api/v1/auth/login` | No | Return JWT tokens for an existing user |
| `POST` | `/api/v1/auth/signin` | No | Alias of `login`; kept for compatibility |
| `POST` | `/api/v1/auth/refresh` | No | Exchange a refresh token for a new token pair |
| `GET` | `/api/v1/auth/me` | Yes | Return the current authenticated user |

All non-auth `/api/v1/*` routes are protected by JWT middleware. For this service, that means `/api/v1/swarm/*` requires authentication.

`GET /health`, OpenAPI docs, and `/api/v1/auth/*` are public, except `/api/v1/auth/me`.

---

## Signup

Creates a user in the `users` table and returns an access token plus refresh token.

```bash
curl -X POST http://localhost:8000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "valid-password",
    "full_name": "Example User"
  }'
```

Response:

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

Response:

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

Use a refresh token to get a new access token and refresh token.

```bash
curl -X POST http://localhost:8000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "<refresh-token>"
  }'
```

Response:

```json
{
  "access_token": "<new-access-token>",
  "refresh_token": "<new-refresh-token>",
  "token_type": "bearer"
}
```

Access tokens are not accepted by `/refresh`; the token must be a refresh token.

---

## Authenticate Requests

Send the access token as a bearer token:

```bash
curl http://localhost:8000/api/v1/swarm/graphs \
  -H "Authorization: Bearer <access-token>"
```

The middleware also accepts an `accessToken` cookie for browser clients:

```text
Cookie: accessToken=<access-token>
```

Header authentication is preferred for API clients because it is explicit and works across all protected endpoints.

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

Run the swarm graph with an authenticated request:

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

---

## Configuration

JWT behavior is configured in `app/core/config.py`:

| Setting | Purpose |
|---------|---------|
| `JWT_SECRET_KEY` | Access-token signing secret |
| `JWT_REFRESH_SECRET_KEY` | Refresh-token signing secret |
| `JWT_ALGORITHM` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access-token lifetime |
| `REFRESH_TOKEN_EXPIRE_MINUTES` | Refresh-token lifetime |

Use non-default secrets in any deployed environment.
