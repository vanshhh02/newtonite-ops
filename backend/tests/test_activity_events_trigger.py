import pytest
from sqlalchemy.exc import DBAPIError
from sqlalchemy import text
from app.models import User, Team, WorkItem, ActivityEvent
from app.security import get_password_hash


def test_activity_events_append_only_trigger(db):
    """
    Test requirement 9: activity_events cannot be updated or deleted.
    A PostgreSQL trigger explicitly rejects any UPDATE or DELETE statement.
    """
    # 1. Setup minimal user, team, work_item
    user = User(
        email="trigger_test@newtonite.local",
        name="Trigger Tester",
        password_hash=get_password_hash("password123"),
    )
    team = Team(name="Trigger Team")
    db.add_all([user, team])
    db.commit()
    db.refresh(user)
    db.refresh(team)

    item = WorkItem(
        team_id=team.id,
        title="Test Trigger Item",
        description="Testing append-only activity trigger",
        type="task",
        status="open",
        priority=2,
        created_by=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # 2. Insert event (must succeed)
    event = ActivityEvent(
        item_id=item.id,
        actor_id=user.id,
        type="created",
        payload={"initial_status": "open"},
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    assert event.id is not None

    # 3. Attempt to UPDATE the activity event (must fail with DB trigger exception)
    with pytest.raises(DBAPIError) as exc_update:
        db.execute(
            text("UPDATE activity_events SET type = 'tampered' WHERE id = :event_id"),
            {"event_id": event.id},
        )
        db.commit()
    db.rollback()
    assert "activity_events is append-only" in str(exc_update.value).lower()

    # 4. Attempt to DELETE the activity event (must fail with DB trigger exception)
    with pytest.raises(DBAPIError) as exc_delete:
        db.execute(
            text("DELETE FROM activity_events WHERE id = :event_id"),
            {"event_id": event.id},
        )
        db.commit()
    db.rollback()
    assert "activity_events is append-only" in str(exc_delete.value).lower()

    # 5. Verify the event is completely intact
    persisted_event = db.query(ActivityEvent).filter(ActivityEvent.id == event.id).first()
    assert persisted_event is not None
    assert persisted_event.type == "created"
