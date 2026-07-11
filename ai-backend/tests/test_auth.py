from collections.abc import AsyncIterator, Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.router import api_router
from app.core.config import Settings
from app.core.config import settings as app_settings
from app.core.security import create_access_token, get_password_hash
from app.db.base import Base
from app.db.session import get_db
from app.main import app as main_app
from app.middleware.auth import JWTAuthMiddleware
from app.models.user import User


@pytest.fixture(autouse=True)
def _local_http_cookie_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_settings, "COOKIE_SECURE", False)


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

    async def stream_run(
        self,
        task_requirement: str,
        thread_id: str,
        *,
        db: object | None = None,
    ) -> AsyncIterator[dict[str, object]]:
        yield {"event": "done", "data": {"thread_id": thread_id, "status": "done"}}


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


def test_login_cookie_authenticates_me() -> None:
    client, session_factory = _client()
    _create_user(session_factory, "cookie-me@example.com")

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "cookie-me@example.com", "password": "valid-password"},
    )
    me = client.get("/api/v1/auth/me")

    assert login.status_code == 200
    assert me.status_code == 200
    assert me.json()["email"] == "cookie-me@example.com"


def test_login_cookie_authenticates_swarm_stream() -> None:
    client, session_factory = _client()
    _create_user(session_factory, "cookie-stream@example.com")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "cookie-stream@example.com", "password": "valid-password"},
    )

    response = client.post(
        "/api/v1/swarm/run/stream",
        json={
            "task_requirement": "Design a URL shortener",
            "thread_id": "auth-cookie-test",
        },
    )

    assert login.status_code == 200
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'event: done' in response.text


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
    rejected = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["access_token"]},
    )
    accepted = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert rejected.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["access_token"]
    assert accepted.json()["refresh_token"]


def test_development_cookies_omit_secure_and_keep_expected_flags() -> None:
    client, _ = _client()

    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "cookie@example.com", "password": "valid-password"},
    )

    assert signup.status_code == 201
    access_cookie = signup.cookies.get("accessToken")
    refresh_cookie = signup.cookies.get("refreshToken")
    assert access_cookie and refresh_cookie

    set_cookie_headers = signup.headers.get_list("set-cookie")
    access_header = next(h for h in set_cookie_headers if h.startswith("accessToken="))
    refresh_header = next(h for h in set_cookie_headers if h.startswith("refreshToken="))
    assert "HttpOnly" in access_header
    assert "Secure" not in access_header
    assert "SameSite=lax" in access_header
    assert "Path=/" in access_header

    assert "HttpOnly" in refresh_header
    assert "Secure" not in refresh_header
    assert "SameSite=strict" in refresh_header
    assert "Path=/api/v1/auth/refresh" in refresh_header
    assert not any(header.startswith("csrfToken=") for header in set_cookie_headers)


def test_production_cookies_include_secure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_settings, "COOKIE_SECURE", True)
    client, _ = _client()

    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "secure-cookie@example.com", "password": "valid-password"},
    )

    set_cookie_headers = signup.headers.get_list("set-cookie")
    access_header = next(h for h in set_cookie_headers if h.startswith("accessToken="))
    refresh_header = next(h for h in set_cookie_headers if h.startswith("refreshToken="))
    assert "HttpOnly" in access_header
    assert "Secure" in access_header
    assert "HttpOnly" in refresh_header
    assert "Secure" in refresh_header


def test_refresh_falls_back_to_cookie_when_body_omitted() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "cookierefresh@example.com", "password": "valid-password"},
    )
    assert signup.status_code == 201

    refreshed = client.post("/api/v1/auth/refresh")

    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]


def test_refresh_without_body_or_cookie_is_rejected() -> None:
    client, _ = _client()

    response = client.post("/api/v1/auth/refresh")

    assert response.status_code == 401


def test_state_changing_cookie_request_needs_no_extra_header() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "cookie-post@example.com", "password": "valid-password"},
    )
    assert signup.status_code == 201

    refreshed = client.post("/api/v1/auth/refresh")

    assert refreshed.status_code == 200


def test_logout_clears_auth_cookies() -> None:
    client, _ = _client()
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "logout@example.com", "password": "valid-password"},
    )
    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert any(
        h.startswith("accessToken=") and "Max-Age=0" in h for h in set_cookie_headers
    )
    assert any(
        h.startswith("refreshToken=") and "Max-Age=0" in h for h in set_cookie_headers
    )
    assert not any(header.startswith("csrfToken=") for header in set_cookie_headers)


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


def test_bearer_header_takes_precedence_over_access_cookie() -> None:
    client, session_factory = _client()
    _create_user(session_factory, "precedence@example.com")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "precedence@example.com", "password": "valid-password"},
    )

    response = client.get(
        "/api/v1/swarm/graphs",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert login.status_code == 200
    assert response.status_code == 401


def test_cors_allows_credentialed_local_frontend_preflight() -> None:
    response = TestClient(main_app).options(
        "/api/v1/swarm/run/stream",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_does_not_allow_unapproved_origin() -> None:
    response = TestClient(main_app).options(
        "/api/v1/swarm/run/stream",
        headers={
            "Origin": "http://malicious.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_local_http_configuration_rejects_secure_cookies() -> None:
    with pytest.raises(ValueError, match="COOKIE_SECURE=false"):
        Settings(
            APP_ENV="development",
            COOKIE_SECURE=True,
            CORS_ALLOWED_ORIGINS="http://localhost:5173",
            _env_file=None,
        )


def test_production_configuration_rejects_insecure_cookies() -> None:
    with pytest.raises(ValueError, match="production requires COOKIE_SECURE=true"):
        Settings(
            APP_ENV="production",
            COOKIE_SECURE=False,
            CORS_ALLOWED_ORIGINS="https://app.example.com",
            _env_file=None,
        )
