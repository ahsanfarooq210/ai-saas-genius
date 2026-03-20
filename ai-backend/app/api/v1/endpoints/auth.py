from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
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
def signin(payload: SignInRequest, db: Session = Depends(get_db)) -> TokenResponse:
    auth_repository = AuthRepository(db)
    auth_service = AuthService(auth_repository)
    return auth_service.signin(payload)


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
