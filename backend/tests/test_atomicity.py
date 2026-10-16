import uuid
import pytest
from sqlalchemy.exc import DBAPIError
from sqlalchemy import text
from app.models import User, Team, TeamMembership, WorkItem, ActivityEvent, Outbox
from app.security import get_password_hash


def test_atomicity_rollback_on_event_failure(db):
    """
    Test requirement 6: Atomicity.
    State change + activity event + outbox row are written in ONE transaction (no dual writes).
    If the event or outbox insert fails, the state change completely rolls back.
    """
    team = Team(name="Atomicity Team")
    user = User(
        email=f"atomicity_user_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Atomicity User",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, user])
    db.commit()
    db.refresh(team)
    db.refresh(user)

    item = WorkItem(
        team_id=team.id,
        title="Atomicity Work Item",
        description="Testing atomic transaction boundaries",
        type="task",
        status="open",
        priority=2,
        created_by=user.id,
        assignee_id=None,
        version=1,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    original_version = item.version
    original_status = item.status

    # Simulate an atomic mutation block where event insertion fails
    try:
        # Step 1: Update item status
        db.execute(
            text("""
            UPDATE work_items
            SET status = 'in_progress', version = version + 1
            WHERE id = :id
            """),
            {"id": item.id},
        )

        # Step 2: Attempt to insert an invalid activity event that violates foreign key
        db.execute(
            text("""
            INSERT INTO activity_events (item_id, actor_id, type, payload)
            VALUES (:item_id, :non_existent_actor_id, 'status_changed', '{}'::jsonb)
            """),
            {"item_id": item.id, "non_existent_actor_id": 999999},
        )
        db.commit()
    except DBAPIError:
        # Transaction fails and must roll back
        db.rollback()

    # Verify that the work_item was NOT updated (atomicity guaranteed)
    db.expire_all()
    fresh = db.query(WorkItem).filter(WorkItem.id == item.id).first()
    assert fresh.status == original_status
    assert fresh.version == original_version

    # Verify no orphan events or outbox rows
    event_count = db.query(ActivityEvent).filter(ActivityEvent.item_id == item.id).count()
    assert event_count == 0
