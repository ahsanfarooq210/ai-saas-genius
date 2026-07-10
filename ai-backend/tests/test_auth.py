from collections.abc import Generator

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.router import api_router
from app.core.config import settings as app_settings
from app.core.security import create_access_token, get_password_hash
from app.db.base import Base
from app.db.session import get_db
from app.middleware.auth import JWTAuthMiddleware
from app.models.user import User

# TestClient talks to the app over plain HTTP; Secure cookies would be
# silently dropped by the client, so disable Secure for this process only.
app_settings.COOKIE_SECURE = False


class FakeSwarmGraphService:
    def list_graphs(self) -> list[dict[str, str | bool]]:
        return [
            {
                "graph_id": "supervisor",
                "name": "Supervisor",
                "description": "Parent orchestration graph",
                "supports_xray": True,
            }
        ]


def _client() -> tuple[TestClient, sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session_local = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )

    app = FastAPI()
    app.add_middleware(JWTAuthMiddleware, session_factory=testing_session_local)
    app.include_router(api_router, prefix="/api/v1")
    app.state.swarm_graph_service = FakeSwarmGraphService()

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), testing_session_local


def _create_user(session_factory: sessionmaker[Session], email: str) -> int:
    with session_factory() as db:
        user = User(
            email=email,
            hashed_password=get_password_hash("valid-password"),
            full_name="Test User",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id


def test_signup_issues_tokens_and_me_returns_user() -> None:
    client, _ = _client()

    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "ada@example.com",
            "password": "valid-password",
            "full_name": "Ada Lovelace",
        },
    )

    assert signup.status_code == 201
    tokens = signup.json()
    assert tokens["token_type"] == "bearer"
    assert tokens["access_token"]
    assert tokens["refresh_token"]

    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert me.status_code == 200
    assert me.json() == {
        "id": 1,
        "email": "ada@example.com",
        "full_name": "Ada Lovelace",
        "is_active": True,
    }


def test_signin_rejects_bad_password_and_accepts_valid_password() -> None:
    client, session_factory = _client()
    _create_user(session_factory, "grace@example.com")

    rejected = client.post(
        "/api/v1/auth/signin",
        json={"email": "grace@example.com", "password": "wrong-password"},
    )
    accepted = client.post(
        "/api/v1/auth/signin",
        json={"email": "grace@example.com", "password": "valid-password"},
    )

    assert rejected.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["access_token"]


def test_login_alias_issues_tokens() -> None:
    client, session_factory = _client()
    _create_user(session_factory, "login@example.com")

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "valid-password"},
    )

    assert response.status_code == 200
    assert response.json()["access_token"]
    assert response.json()["refresh_token"]


def test_refresh_requires_refresh_token_type() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "linus@example.com",
            "password": "valid-password",
        },
    )
    tokens = signup.json()
    csrf_headers = {"X-CSRF-Token": signup.cookies.get("csrfToken")}

    rejected = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["access_token"]},
        headers=csrf_headers,
    )
    accepted = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
        headers=csrf_headers,
    )

    assert rejected.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["access_token"]
    assert accepted.json()["refresh_token"]


def test_signup_sets_httponly_cookies_with_expected_flags() -> None:
    client, _ = _client()

    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "cookie@example.com", "password": "valid-password"},
    )

    assert signup.status_code == 201
    access_cookie = signup.cookies.get("accessToken")
    refresh_cookie = signup.cookies.get("refreshToken")
    csrf_cookie = signup.cookies.get("csrfToken")
    assert access_cookie and refresh_cookie and csrf_cookie

    set_cookie_headers = signup.headers.get_list("set-cookie")
    access_header = next(h for h in set_cookie_headers if h.startswith("accessToken="))
    refresh_header = next(h for h in set_cookie_headers if h.startswith("refreshToken="))
    csrf_header = next(h for h in set_cookie_headers if h.startswith("csrfToken="))

    assert "HttpOnly" in access_header
    assert "SameSite=lax" in access_header
    assert "Path=/" in access_header

    assert "HttpOnly" in refresh_header
    assert "SameSite=strict" in refresh_header
    assert "Path=/api/v1/auth/refresh" in refresh_header

    assert "HttpOnly" not in csrf_header


def test_refresh_falls_back_to_cookie_when_body_omitted() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "cookierefresh@example.com", "password": "valid-password"},
    )
    assert signup.status_code == 201

    csrf_token = signup.cookies.get("csrfToken")
    refreshed = client.post(
        "/api/v1/auth/refresh",
        headers={"X-CSRF-Token": csrf_token},
    )

    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]


def test_refresh_without_body_or_cookie_is_rejected() -> None:
    client, _ = _client()

    response = client.post("/api/v1/auth/refresh")

    assert response.status_code == 401


def test_state_changing_cookie_request_without_csrf_header_is_rejected() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "csrf@example.com", "password": "valid-password"},
    )
    assert signup.status_code == 201

    rejected = client.post("/api/v1/auth/refresh")

    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "CSRF token missing or invalid"


def test_bearer_header_request_is_exempt_from_csrf_check() -> None:
    client, session_factory = _client()
    user_id = _create_user(session_factory, "bearer-csrf@example.com")
    access_token = create_access_token(str(user_id))

    response = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200


def test_logout_clears_auth_cookies() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "logout@example.com", "password": "valid-password"},
    )
    csrf_token = signup.cookies.get("csrfToken")

    response = client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": csrf_token},
    )

    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert any(
        h.startswith("accessToken=") and "Max-Age=0" in h for h in set_cookie_headers
    )
    assert any(
        h.startswith("refreshToken=") and "Max-Age=0" in h for h in set_cookie_headers
    )


def test_swarm_routes_require_valid_bearer_token() -> None:
    client, session_factory = _client()

    missing_token = client.get("/api/v1/swarm/graphs")

    user_id = _create_user(session_factory, "route-user@example.com")
    access_token = create_access_token(str(user_id))
    authenticated = client.get(
        "/api/v1/swarm/graphs",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert missing_token.status_code == 401
    assert missing_token.headers["WWW-Authenticate"] == "Bearer"
    assert authenticated.status_code == 200
    assert authenticated.json()["graphs"][0]["graph_id"] == "supervisor"
