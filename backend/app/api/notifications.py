from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db
from app.models import User, Notification
from app.schemas import (
    NotificationListResponse,
    NotificationOut,
    UnreadCountResponse,
)
from app.deps import get_current_user
from app.exceptions import AppException

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=NotificationListResponse)
def list_notifications(
    unread_only: bool = Query(False),
    cursor: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List notifications for current user with keyset pagination by ID.
    Supports filtering by unread_only.
    """
    query = db.query(Notification).filter(Notification.user_id == current_user.id)

    if unread_only:
        query = query.filter(Notification.read_at.is_(None))

    if cursor is not None:
        query = query.filter(Notification.id < cursor)

    rows = query.order_by(Notification.id.desc()).limit(limit + 1).all()

    has_next = len(rows) > limit
    page_rows = rows[:limit]

    next_cursor = str(page_rows[-1].id) if has_next and page_rows else None

    notifications_out = [
        NotificationOut(
            id=n.id,
            item_id=n.item_id,
            item_key=f"OPS-{n.item_id}",
            type=n.type,
            message=n.message,
            read_at=n.read_at,
            created_at=n.created_at,
        )
        for n in page_rows
    ]

    return NotificationListResponse(
        notifications=notifications_out,
        next_cursor=next_cursor,
    )


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the total count of unread notifications for current user."""
    count = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
        )
        .count()
    )
    return UnreadCountResponse(count=count)


@router.post("/notifications/{id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a specific notification as read."""
    notif = (
        db.query(Notification)
        .filter(
            Notification.id == id,
            Notification.user_id == current_user.id,
        )
        .first()
    )
    if not notif:
        raise AppException(
            status_code=404,
            code="not_found",
            message="Notification not found",
        )

    if notif.read_at is None:
        notif.read_at = datetime.now(timezone.utc)
        db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark all unread notifications for the current user as read."""
    now = datetime.now(timezone.utc)
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read_at.is_(None),
    ).update({"read_at": now}, synchronize_session=False)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
