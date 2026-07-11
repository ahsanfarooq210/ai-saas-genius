from collections.abc import Callable, Sequence

from fastapi import Request
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.core.config import settings
from app.core.cookies import ACCESS_TOKEN_COOKIE
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.user import User


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
