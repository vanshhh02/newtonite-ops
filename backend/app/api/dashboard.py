from datetime import datetime, timezone, timedelta
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, TeamMembership
from app.schemas import DashboardSummaryResponse, DashboardCounts
from app.deps import get_current_user
from app.config import settings

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get dashboard summary counters.
    Calculated across all teams the caller is a member of.
    Uses indexed predicates for sub-millisecond execution.
    """
    # 1. Fetch user team memberships
    memberships = (
        db.query(TeamMembership)
        .filter(TeamMembership.user_id == current_user.id)
        .all()
    )

    if not memberships:
        return DashboardSummaryResponse(
            counts=DashboardCounts(
                assigned_to_me=0,
                unassigned_urgent=0,
                awaiting_my_approval=0,
                overdue=0,
                stale=0,
            )
        )

    caller_team_ids = [m.team_id for m in memberships]
    caller_lead_team_ids = [m.team_id for m in memberships if m.role == "lead"]
    if not caller_lead_team_ids:
        # Avoid empty list syntax in SQL array parameter
        caller_lead_team_ids = [-1]

    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(hours=settings.STALE_AFTER_HOURS)

    # 2. Fast single-roundtrip query with indexed FILTER aggregations
    sql = text("""
        SELECT
            COUNT(*) FILTER (
                WHERE assignee_id = :user_id
                  AND status IN ('open', 'in_progress', 'awaiting_approval')
            ) AS assigned_to_me,

            COUNT(*) FILTER (
                WHERE assignee_id IS NULL
                  AND status = 'open'
                  AND priority = 4
            ) AS unassigned_urgent,

            COUNT(*) FILTER (
                WHERE status = 'awaiting_approval'
                  AND team_id = ANY(:lead_team_ids)
                  AND (assignee_id IS NULL OR assignee_id != :user_id)
            ) AS awaiting_my_approval,

            COUNT(*) FILTER (
                WHERE due_at IS NOT NULL
                  AND due_at < :now
                  AND status IN ('open', 'in_progress', 'awaiting_approval')
            ) AS overdue,

            COUNT(*) FILTER (
                WHERE status IN ('in_progress', 'awaiting_approval')
                  AND last_activity_at < :stale_threshold
            ) AS stale
        FROM work_items
        WHERE team_id = ANY(:team_ids);
    """)

    result = db.execute(
        sql,
        {
            "user_id": current_user.id,
            "team_ids": caller_team_ids,
            "lead_team_ids": caller_lead_team_ids,
            "now": now,
            "stale_threshold": stale_threshold,
        },
    ).one()

    return DashboardSummaryResponse(
        counts=DashboardCounts(
            assigned_to_me=result.assigned_to_me or 0,
            unassigned_urgent=result.unassigned_urgent or 0,
            awaiting_my_approval=result.awaiting_my_approval or 0,
            overdue=result.overdue or 0,
            stale=result.stale or 0,
        )
    )
