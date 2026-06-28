from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    RefreshTokenRequest,
    SignInRequest,
    SignUpRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth")


def _issue_tokens(user: User) -> TokenResponse:
    subject = str(user.id)
    return TokenResponse(
        access_token=create_access_token(subject),
        refresh_token=create_refresh_token(subject),
    )


def _get_active_user(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def sign_up(body: SignUpRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = str(body.email).lower()
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        )

    user = User(
        email=email,
        hashed_password=get_password_hash(body.password),
        full_name=body.full_name,
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        ) from None

    db.refresh(user)
    return _issue_tokens(user)


@router.post("/login", response_model=TokenResponse)
@router.post("/signin", response_model=TokenResponse)
def sign_in(body: SignInRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = str(body.email).lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise _invalid_credentials()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    body: RefreshTokenRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token, token_type="refresh")
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise _invalid_credentials() from None

    user = _get_active_user(db, user_id)
    if user is None:
        raise _invalid_credentials()

    return _issue_tokens(user)


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
