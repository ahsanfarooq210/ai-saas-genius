from collections.abc import Generator

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.router import api_router
from app.core.security import create_access_token, get_password_hash
from app.db.base import Base
from app.db.session import get_db
from app.middleware.auth import JWTAuthMiddleware
from app.models.user import User


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
