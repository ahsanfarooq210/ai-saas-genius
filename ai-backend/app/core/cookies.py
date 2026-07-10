from fastapi import Response

from app.core.config import settings

ACCESS_TOKEN_COOKIE = "accessToken"
REFRESH_TOKEN_COOKIE = "refreshToken"
CSRF_TOKEN_COOKIE = "csrfToken"
CSRF_HEADER_NAME = "X-CSRF-Token"

# Scoped narrowly so the refresh token is never sent to unrelated routes.
REFRESH_TOKEN_COOKIE_PATH = f"{settings.API_V1_PREFIX}/auth/refresh"


def set_auth_cookies(
    response: Response,
    *,
    access_token: str,
    refresh_token: str,
    csrf_token: str,
) -> None:
    response.set_cookie(
        ACCESS_TOKEN_COOKIE,
        access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        path=REFRESH_TOKEN_COOKIE_PATH,
    )
    # Deliberately NOT httpOnly: the frontend reads this value and echoes it
    # back via the X-CSRF-Token header (double-submit cookie pattern).
    response.set_cookie(
        CSRF_TOKEN_COOKIE,
        csrf_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        ACCESS_TOKEN_COOKIE,
        path="/",
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )
    response.delete_cookie(
        REFRESH_TOKEN_COOKIE,
        path=REFRESH_TOKEN_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
    )
    response.delete_cookie(
        CSRF_TOKEN_COOKIE,
        path="/",
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )
