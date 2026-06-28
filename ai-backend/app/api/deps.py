from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.middleware.auth import get_access_token_from_request
from app.models.user import User
from app.services.swarm_graph_service import SwarmGraphService

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_PREFIX}/auth/signin", auto_error=False
)


def get_swarm_graph_service(request: Request) -> SwarmGraphService:
    return request.app.state.swarm_graph_service


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        access_token = token or get_access_token_from_request(request)
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            payload = decode_token(access_token, token_type="access")
            user_id = int(payload.get("sub"))
        except (TypeError, ValueError):
            raise credentials_exception

    user = (
        db.query(User)
        .filter(User.id == user_id, User.is_active.is_(True))
        .first()
    )
    if user is None:
        raise credentials_exception

    return user


SwarmGraphServiceDep = Annotated[SwarmGraphService, Depends(get_swarm_graph_service)]
