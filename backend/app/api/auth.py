from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, TeamMembership, Team
from app.schemas import (
    LoginRequest,
    LoginResponse,
    UserBrief,
    MeResponse,
    TeamMembershipOut,
    TeamMemberOut,
)
from app.security import verify_password, create_access_token
from app.exceptions import AppException
from app.deps import get_current_user

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=LoginResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with email and password, returning JWT access token."""
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise AppException(
            status_code=401,
            code="unauthenticated",
            message="Invalid email or password",
        )

    token = create_access_token({"sub": str(user.id)})
    return LoginResponse(
        access_token=token,
        user=UserBrief(id=user.id, name=user.name, email=user.email),
    )


@router.get("/me", response_model=MeResponse)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current authenticated user info and team memberships."""
    memberships = (
        db.query(TeamMembership, Team)
        .join(Team, Team.id == TeamMembership.team_id)
        .filter(TeamMembership.user_id == current_user.id)
        .all()
    )

    out_memberships = [
        TeamMembershipOut(
            team_id=m.team_id,
            team_name=t.name,
            role=m.role,
        )
        for m, t in memberships
    ]

    return MeResponse(
        user=UserBrief(id=current_user.id, name=current_user.name, email=current_user.email),
        memberships=out_memberships,
    )


@router.get("/teams/{team_id}/members", response_model=List[TeamMemberOut])
def get_team_members(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List members of a team.
    Caller must be a member of the team to view its roster; otherwise returns 404.
    """
    caller_membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == team_id,
        )
        .first()
    )

    if not caller_membership:
        # Don't leak team existence to non-members
        raise AppException(
            status_code=404,
            code="not_found",
            message="Team not found",
        )

    members = (
        db.query(TeamMembership, User)
        .join(User, User.id == TeamMembership.user_id)
        .filter(TeamMembership.team_id == team_id)
        .all()
    )

    return [
        TeamMemberOut(
            user_id=u.id,
            name=u.name,
            role=m.role,
        )
        for m, u in members
    ]
