from fastapi import HTTPException, status

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.models.user import User
from app.repositories.auth_repository import AuthRepository
from app.schemas.auth import RefreshTokenRequest, SignInRequest, SignUpRequest, TokenResponse


class AuthService:
    def __init__(self, auth_repository: AuthRepository) -> None:
        self.auth_repository = auth_repository

    def signup(self, payload: SignUpRequest) -> User:
        existing_user = self.auth_repository.get_by_email(payload.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")

        return self.auth_repository.create_user(
            email=payload.email,
            hashed_password=get_password_hash(payload.password),
            full_name=payload.full_name,
        )

    def signin(self, payload: SignInRequest) -> TokenResponse:
        user = self.auth_repository.get_by_email(payload.email)
        if user is None or not verify_password(payload.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))
        return TokenResponse(access_token=access_token, refresh_token=refresh_token)

    def refresh_token(self, payload: RefreshTokenRequest) -> TokenResponse:
        try:
            token_payload = decode_token(payload.refresh_token, token_type="refresh")
            user_id = int(token_payload.get("sub"))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )

        user = self.auth_repository.get_by_id(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))
        return TokenResponse(access_token=access_token, refresh_token=refresh_token)
