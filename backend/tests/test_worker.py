import concurrent.futures
import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import User, Team, TeamMembership, WorkItem, ActivityEvent, Outbox, Notification
from app.security import get_password_hash, create_access_token
from app.worker import process_outbox_batch, process_single_outbox_row, handle_outbox_failure
from tests.conftest import get_test_db_session

client = TestClient(app)


def test_worker_concurrency_and_idempotency(db):
    """
    Test requirement 7:
    - Two concurrent workers never double-process (SKIP LOCKED).
    - Processing the same outbox row twice yields exactly ONE notification row.
    """
    team = Team(name="Worker Concurrency Team")
    actor = User(
        email=f"worker_actor_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Actor Lead",
        password_hash=get_password_hash("password123"),
    )
    recipient = User(
        email=f"worker_recipient_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Target Assignee",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, actor, recipient])
    db.commit()
    db.refresh(team)
    db.refresh(actor)
    db.refresh(recipient)

    item = WorkItem(
        team_id=team.id,
        title="Worker Item",
        description="Testing worker locks",
        type="task",
        status="open",
        priority=2,
        created_by=actor.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # 1. Insert 10 distinct activity events and pending outbox records
    outbox_ids = []
    for i in range(10):
        ev = ActivityEvent(
            item_id=item.id,
            actor_id=actor.id,
            type="assigned",
            payload={"from": None, "to": recipient.id},
        )
        db.add(ev)
        db.flush()

        out = Outbox(
            type="item_assigned",
            payload={
                "event_id": ev.id,
                "item_id": item.id,
                "item_key": f"OPS-{item.id}",
                "recipient_id": recipient.id,
                "actor_id": actor.id,
                "message": f"Task {i} assigned to you",
            },
            status="pending",
            available_at=datetime.now(timezone.utc) - timedelta(seconds=10),
        )
        db.add(out)
        db.flush()
        outbox_ids.append(out.id)
    db.commit()

    # 2. Run two concurrent workers on the pending records
    def worker_job():
        worker_session = get_test_db_session()
        try:
            return process_outbox_batch(worker_session, batch_size=10)
        finally:
            worker_session.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(worker_job)
        f2 = executor.submit(worker_job)
        processed1 = f1.result()
        processed2 = f2.result()

    # The two workers collectively processed all 10 records without collision
    assert processed1 + processed2 == 10

    # 3. Verify all outbox records are done
    db.expire_all()
    done_count = db.query(Outbox).filter(Outbox.id.in_(outbox_ids), Outbox.status == "done").count()
    assert done_count == 10

    # 4. Test Idempotency: re-process the exact same event row again
    # In an at-least-once delivery queue, re-delivery must NOT produce duplicate notifications
    test_out = db.query(Outbox).filter(Outbox.id == outbox_ids[0]).first()
    process_single_outbox_row(db, test_out)
    db.commit()

    # Notification count for that event_id must remain strictly 1
    event_notif_count = (
        db.query(Notification)
        .filter(Notification.event_id == test_out.payload["event_id"], Notification.user_id == recipient.id)
        .count()
    )
    assert event_notif_count == 1


def test_worker_retries_and_dead_letter(db):
    """
    Test requirement 7 (failure lifecycle):
    Failure -> retry with exponential backoff -> mark dead after 5 attempts.
    """
    out = Outbox(
        type="corrupt_type",
        payload={
            "recipient_id": None,
            "message": "Fails processing",
        },
        attempts=0,
        status="pending",
    )
    db.add(out)
    db.commit()
    db.refresh(out)

    # 1. Simulate 4 successive failures
    for attempt in range(1, 5):
        handle_outbox_failure(db, out.id, f"Network timeout #{attempt}")
        db.refresh(out)
        assert out.status == "pending"
        assert out.attempts == attempt
        assert out.last_error == f"Network timeout #{attempt}"
        assert out.available_at > datetime.now(timezone.utc)  # exponential backoff delay

    # 2. 5th failure exceeds MAX_ATTEMPTS -> transitions to 'dead'
    handle_outbox_failure(db, out.id, "Fatal unrecoverable error on 5th attempt")
    db.refresh(out)
    assert out.status == "dead"
    assert out.attempts == 5
    assert "Fatal unrecoverable error" in out.last_error


def test_notifications_api_and_read_endpoints(db):
    """Test notification retrieval, unread count, and marking read/read-all."""
    user = User(
        email=f"notif_user_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Notif User",
        password_hash=get_password_hash("password123"),
    )
    team = Team(name="Notif Team")
    db.add_all([user, team])
    db.commit()
    db.refresh(user)
    db.refresh(team)

    item = WorkItem(
        team_id=team.id,
        title="Notif Item",
        description="Description",
        type="task",
        status="open",
        priority=2,
        created_by=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Insert 3 notifications for this user with real activity events
    notifs = []
    for i in range(3):
        ev = ActivityEvent(
            item_id=item.id,
            actor_id=user.id,
            type="created",
            payload={"idx": i},
        )
        db.add(ev)
        db.flush()

        n = Notification(
            user_id=user.id,
            item_id=item.id,
            event_id=ev.id,
            type="item_assigned",
            message=f"Alert #{i}",
        )
        db.add(n)
        notifs.append(n)
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Unread count -> 3
    res_count = client.get("/notifications/unread-count", headers=headers)
    assert res_count.status_code == 200
    assert res_count.json()["count"] == 3

    # 2. List notifications
    res_list = client.get("/notifications?unread_only=true", headers=headers)
    assert res_list.status_code == 200
    data = res_list.json()
    assert len(data["notifications"]) == 3

    target_notif = notifs[0]
    # 3. Mark single notification as read -> 204
    res_read = client.post(f"/notifications/{target_notif.id}/read", headers=headers)
    assert res_read.status_code == 204

    res_count_after = client.get("/notifications/unread-count", headers=headers)
    assert res_count_after.json()["count"] == 2

    # 4. Mark all as read -> 204
    res_read_all = client.post("/notifications/read-all", headers=headers)
    assert res_read_all.status_code == 204

    res_count_final = client.get("/notifications/unread-count", headers=headers)
    assert res_count_final.json()["count"] == 0
