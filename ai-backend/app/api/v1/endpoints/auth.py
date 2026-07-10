from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.cookies import clear_auth_cookies, set_auth_cookies
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_csrf_token,
    get_password_hash,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    LogoutResponse,
    RefreshTokenRequest,
    SignInRequest,
    SignUpRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth")


def _issue_tokens(user: User, response: Response) -> TokenResponse:
    subject = str(user.id)
    tokens = TokenResponse(
        access_token=create_access_token(subject),
        refresh_token=create_refresh_token(subject),
    )
    # Cookies are the authoritative transport going forward; the JSON body is
    # kept only for existing bearer-header consumers during the migration.
    set_auth_cookies(
        response,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        csrf_token=generate_csrf_token(),
    )
    return tokens


def _get_active_user(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def sign_up(body: SignUpRequest, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
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
    return _issue_tokens(user, response)


@router.post("/login", response_model=TokenResponse)
@router.post("/signin", response_model=TokenResponse)
def sign_in(
    body: SignInRequest, response: Response, db: Session = Depends(get_db)
) -> TokenResponse:
    email = str(body.email).lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise _invalid_credentials()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    return _issue_tokens(user, response)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    body: RefreshTokenRequest | None = None,
    db: Session = Depends(get_db),
) -> TokenResponse:
    # Explicit body value wins (bearer-style clients); cookie clients omit the
    # body since the refreshToken cookie is httpOnly and unreadable by JS.
    refresh_value = (body.refresh_token if body else None) or request.cookies.get(
        "refreshToken"
    )
    if not refresh_value:
        raise _invalid_credentials()

    try:
        payload = decode_token(refresh_value, token_type="refresh")
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise _invalid_credentials() from None

    user = _get_active_user(db, user_id)
    if user is None:
        raise _invalid_credentials()

    return _issue_tokens(user, response)


@router.post("/logout", response_model=LogoutResponse)
def logout(response: Response) -> LogoutResponse:
    # No token blacklist/allowlist exists yet, so this only clears the
    # cookies client-side; a still-valid access/refresh token presented via
    # the Authorization header would keep working until it expires. See
    # docs/current/authentication.md for the tracked follow-up.
    clear_auth_cookies(response)
    return LogoutResponse(detail="Logged out")


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
