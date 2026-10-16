import concurrent.futures
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import User, Team, TeamMembership, WorkItem, ActivityEvent, IdempotencyKey
from app.security import get_password_hash, create_access_token

client = TestClient(app)


def test_sequential_idempotency_replay(db):
    """
    Test requirement 3 (sequential):
    Same key + same body -> replays stored response with Idempotent-Replay: true.
    Produces exactly one item and one activity event.
    """
    team = Team(name="Idem Seq Team")
    user = User(
        email=f"idem_user_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Idem User",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, user])
    db.commit()
    db.refresh(team)
    db.refresh(user)

    db.add(TeamMembership(user_id=user.id, team_id=team.id, role="member"))
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    idem_key = str(uuid.uuid4())
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }
    payload = {
        "team_id": team.id,
        "title": "Idempotent Created Task",
        "description": "Ensuring exactly-once creation semantics",
        "type": "task",
        "priority": "medium",
    }

    # 1. First execution
    res1 = client.post("/items", json=payload, headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    item_id = data1["id"]
    assert "Idempotent-Replay" not in res1.headers

    # 2. Sequential duplicate replay
    res2 = client.post("/items", json=payload, headers=headers)
    assert res2.status_code == 200
    assert res2.headers.get("Idempotent-Replay") == "true"
    data2 = res2.json()
    assert data2["id"] == item_id
    assert data2["title"] == data1["title"]

    # 3. Database assertion: exactly one work item, exactly one event
    items_count = db.query(WorkItem).filter(WorkItem.title == "Idempotent Created Task").count()
    assert items_count == 1

    events_count = db.query(ActivityEvent).filter(ActivityEvent.item_id == item_id).count()
    assert events_count == 1


def test_concurrent_idempotent_creates(db):
    """
    Test requirement 3 (concurrent):
    Multiple concurrent requests with same key and body produce exactly one item.
    """
    team = Team(name="Idem Concur Team")
    user = User(
        email=f"idem_concur_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Idem Concur User",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, user])
    db.commit()
    db.refresh(team)
    db.refresh(user)

    db.add(TeamMembership(user_id=user.id, team_id=team.id, role="member"))
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    idem_key = str(uuid.uuid4())
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }
    payload = {
        "team_id": team.id,
        "title": "Concurrent Idempotent Creation",
        "description": "Testing serialization on unique idempotency constraint",
        "type": "customer_issue",
        "priority": "high",
    }

    def send_create():
        return client.post("/items", json=payload, headers=headers)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(send_create) for _ in range(5)]
        responses = [f.result() for f in futures]

    for r in responses:
        assert r.status_code == 200

    item_ids = {r.json()["id"] for r in responses}
    assert len(item_ids) == 1, "All concurrent requests must return the exact same item ID"

    single_id = item_ids.pop()
    db.expire_all()
    assert db.query(WorkItem).filter(WorkItem.id == single_id).count() == 1
    assert db.query(ActivityEvent).filter(ActivityEvent.item_id == single_id).count() == 1


def test_idempotency_key_reuse_different_body_rejected(db):
    """
    Test requirement 3 (conflict):
    Same key + different body -> 422 idempotency_key_reused.
    """
    team = Team(name="Idem Reused Team")
    user = User(
        email=f"idem_reused_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Idem Reused User",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, user])
    db.commit()
    db.refresh(team)
    db.refresh(user)

    db.add(TeamMembership(user_id=user.id, team_id=team.id, role="member"))
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    idem_key = str(uuid.uuid4())
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }

    # First request
    res1 = client.post(
        "/items",
        json={
            "team_id": team.id,
            "title": "First Body Payload",
            "description": "Description A",
            "type": "task",
            "priority": "low",
        },
        headers=headers,
    )
    assert res1.status_code == 200

    # Second request with different title
    res2 = client.post(
        "/items",
        json={
            "team_id": team.id,
            "title": "Different Second Body Payload",
            "description": "Description A",
            "type": "task",
            "priority": "low",
        },
        headers=headers,
    )
    assert res2.status_code == 422
    assert res2.json()["error"]["code"] == "idempotency_key_reused"


def test_failed_request_does_not_consume_key(db):
    """
    Test requirement 3 (failure rollback):
    A failed request (e.g., non-existent team -> 404) rolls back without saving the idempotency key,
    allowing subsequent retry with the same key to succeed.
    """
    team = Team(name="Idem Retry Team")
    user = User(
        email=f"idem_retry_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Idem Retry User",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, user])
    db.commit()
    db.refresh(team)
    db.refresh(user)

    db.add(TeamMembership(user_id=user.id, team_id=team.id, role="member"))
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    idem_key = str(uuid.uuid4())
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }

    # 1. Attempt with invalid non-existent team_id -> 404
    res_fail = client.post(
        "/items",
        json={
            "team_id": 999999,
            "title": "Will Fail",
            "description": "Testing rollback on failure",
            "type": "task",
            "priority": "low",
        },
        headers=headers,
    )
    assert res_fail.status_code == 404

    # Check key was NOT persisted in idempotency_keys
    assert db.query(IdempotencyKey).filter(IdempotencyKey.key == idem_key).count() == 0

    # 2. Retry with valid team_id and same key -> succeeds 200
    res_success = client.post(
        "/items",
        json={
            "team_id": team.id,
            "title": "Succeeded On Retry",
            "description": "Testing rollback on failure",
            "type": "task",
            "priority": "low",
        },
        headers=headers,
    )
    assert res_success.status_code == 200
    assert db.query(IdempotencyKey).filter(IdempotencyKey.key == idem_key).count() == 1
