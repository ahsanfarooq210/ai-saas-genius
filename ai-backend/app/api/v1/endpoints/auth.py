from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.repositories.auth_repository import AuthRepository
from app.schemas.auth import (
    RefreshTokenRequest,
    SignInRequest,
    SignUpRequest,
    TokenResponse,
)
from app.schemas.user import UserRead
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/signup", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def signup(payload: SignUpRequest, db: Session = Depends(get_db)) -> User:
    auth_repository = AuthRepository(db)
    auth_service = AuthService(auth_repository)
    return auth_service.signup(payload)


@router.post("/signin", response_model=TokenResponse)
def signin(
    payload: SignInRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    auth_repository = AuthRepository(db)
    auth_service = AuthService(auth_repository)
    token_response = auth_service.signin(payload)

    secure_cookie = settings.APP_ENV.lower() == "production"

    response.set_cookie(
        key="accessToken",
        value=token_response.access_token,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key="refreshToken",
        value=token_response.refresh_token,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_MINUTES * 60,
    )

    return token_response


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    payload: RefreshTokenRequest, db: Session = Depends(get_db)
) -> TokenResponse:
    auth_repository = AuthRepository(db)
    auth_service = AuthService(auth_repository)
    return auth_service.refresh_token(payload)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
