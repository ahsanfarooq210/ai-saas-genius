import secrets
from collections.abc import Callable, Sequence

from fastapi import Request
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.core.config import settings
from app.core.cookies import (
    ACCESS_TOKEN_COOKIE,
    CSRF_HEADER_NAME,
    CSRF_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
)
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.user import User

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def get_access_token_from_request(request: Request) -> str | None:
    """Resolve the access token for a request.

    Canonical precedence: `Authorization: Bearer <token>` header first, then
    the `accessToken` cookie. This keeps existing bearer-header API clients
    working unchanged while letting browser clients rely on the cookie alone.
    """
    authorization = request.headers.get("Authorization")
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            return token.strip()

    cookie_token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    if cookie_token:
        return cookie_token

    return None


def _unauthorized(detail: str) -> JSONResponse:
    return JSONResponse(
        {"detail": detail},
        status_code=401,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _csrf_rejected() -> JSONResponse:
    return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)


def verify_csrf(request: Request) -> JSONResponse | None:
    """Double-submit CSRF check for cookie-authenticated, state-changing requests.

    Skipped when: the method is safe (GET/HEAD/OPTIONS/TRACE), the request
    carries an explicit `Authorization` bearer header (not exploitable via
    CSRF since browsers won't auto-attach custom headers cross-site), or
    neither auth cookie is present (e.g. signup/first sign-in, before any
    cookie has been issued).
    """
    if request.method.upper() in _SAFE_METHODS:
        return None
    if request.headers.get("Authorization"):
        return None
    if not (request.cookies.get(ACCESS_TOKEN_COOKIE) or request.cookies.get(REFRESH_TOKEN_COOKIE)):
        return None

    csrf_cookie = request.cookies.get(CSRF_TOKEN_COOKIE)
    csrf_header = request.headers.get(CSRF_HEADER_NAME)
    if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
        return _csrf_rejected()

    return None


def _matches_path_prefix(path: str, prefix: str) -> bool:
    normalized = prefix.rstrip("/")
    return path == normalized or path.startswith(f"{normalized}/")


class JWTAuthMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        protected_prefixes: Sequence[str] | None = None,
        public_paths: Sequence[str] | None = None,
        session_factory: Callable[[], Session] = SessionLocal,
    ) -> None:
        super().__init__(app)
        self.protected_prefixes = tuple(protected_prefixes or (settings.API_V1_PREFIX,))
        self.public_paths = tuple(
            public_paths
            or (
                f"{settings.API_V1_PREFIX}/auth",
                "/health",
                "/docs",
                "/redoc",
                "/openapi.json",
            )
        )
        self.session_factory = session_factory

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.user_id = None

        # Runs for every path (including public /auth/refresh and
        # /auth/logout), since those also mutate state using auth cookies.
        csrf_rejection = verify_csrf(request)
        if csrf_rejection is not None:
            return csrf_rejection

        if not self._requires_auth(request.url.path):
            return await call_next(request)

        access_token = get_access_token_from_request(request)
        if not access_token:
            return _unauthorized("Not authenticated")

        try:
            payload = decode_token(access_token, token_type="access")
            user_id = int(payload.get("sub"))
        except (TypeError, ValueError):
            return _unauthorized("Could not validate credentials")

        with self.session_factory() as db:
            user = (
                db.query(User)
                .filter(User.id == user_id, User.is_active.is_(True))
                .first()
            )
            if user is None:
                return _unauthorized("Could not validate credentials")

            request.state.user_id = user.id

        return await call_next(request)

    def _requires_auth(self, path: str) -> bool:
        if any(
            _matches_path_prefix(path, public_path)
            for public_path in self.public_paths
        ):
            return False
        return any(
            _matches_path_prefix(path, protected_prefix)
            for protected_prefix in self.protected_prefixes
        )
