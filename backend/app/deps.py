from typing import Tuple, Optional
from fastapi import Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, WorkItem, TeamMembership
from app.security import decode_access_token
from app.exceptions import AppException
from app.policy import allowed_actions

security_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Validate Bearer token and return current authenticated User."""
    if not credentials or not credentials.credentials:
        raise AppException(
            status_code=401,
            code="unauthenticated",
            message="Missing or invalid authentication token",
        )

    payload = decode_access_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise AppException(
            status_code=401,
            code="unauthenticated",
            message="Invalid or expired access token",
        )

    try:
        user_id = int(payload["sub"])
    except (ValueError, TypeError):
        raise AppException(
            status_code=401,
            code="unauthenticated",
            message="Malformed token payload",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise AppException(
            status_code=401,
            code="unauthenticated",
            message="User account no longer exists",
        )

    return user


def get_item_and_role(
    id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Tuple[WorkItem, str]:
    """
    Load work item and verify caller has team membership.
    
    CRITICAL SECURITY RULE:
    If the caller does not belong to the item's team, return 404 Not Found.
    Never return 403 for items outside caller's teams to prevent enumerating item IDs or team existence.
    """
    item = db.query(WorkItem).filter(WorkItem.id == id).first()
    if not item:
        raise AppException(
            status_code=404,
            code="not_found",
            message="Work item not found",
        )

    membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == user.id,
            TeamMembership.team_id == item.team_id,
        )
        .first()
    )

    if not membership:
        # Don't leak item existence across team boundaries
        raise AppException(
            status_code=404,
            code="not_found",
            message="Work item not found",
        )

    return item, membership.role
