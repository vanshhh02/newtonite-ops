import concurrent.futures
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import User, Team, TeamMembership, WorkItem, ActivityEvent
from app.security import get_password_hash, create_access_token

client = TestClient(app)


def test_concurrent_claim_race(db):
    """
    Test requirement 1: Claim race.
    20 concurrent claims on one item (separate connections/tokens) ->
    exactly one 200, nineteen 409 already_claimed, one assignee, one claimed event.
    """
    # 1. Setup team and 20 member users
    team = Team(name="Claim Race Team")
    db.add(team)
    db.commit()
    db.refresh(team)

    users = []
    tokens = []
    for i in range(20):
        u = User(
            email=f"claim_racer_{i}_{uuid.uuid4().hex[:6]}@newtonite.local",
            name=f"Claim Racer {i}",
            password_hash=get_password_hash("password123"),
        )
        db.add(u)
        users.append(u)
    db.commit()

    for u in users:
        db.refresh(u)
        db.add(TeamMembership(user_id=u.id, team_id=team.id, role="member"))
        tokens.append(create_access_token({"sub": str(u.id)}))
    db.commit()

    # 2. Setup one unassigned open item
    item = WorkItem(
        team_id=team.id,
        title="Contended Claim Item",
        description="20 workers race to claim this atomic item",
        type="task",
        status="open",
        priority=3,
        created_by=users[0].id,
        assignee_id=None,
        version=1,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    target_item_id = item.id

    # 3. Launch 20 concurrent claim requests
    def do_claim(token: str):
        headers = {
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": str(uuid.uuid4()),
        }
        # Use TestClient with independent request
        res = client.post(f"/items/{target_item_id}/claim", json={}, headers=headers)
        return res.status_code, res.json()

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(do_claim, tok) for tok in tokens]
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())

    # 4. Verify distribution of responses
    successes = [r for r in results if r[0] == 200]
    conflicts = [r for r in results if r[0] == 409]

    assert len(successes) == 1, f"Expected exactly 1 claim winner, got {len(successes)}"
    assert len(conflicts) == 19, f"Expected 19 claim conflicts, got {len(conflicts)}"

    # Check 409 error structure
    for code, body in conflicts:
        assert body["error"]["code"] == "already_claimed"
        assert body["error"]["details"]["current"]["status"] == "in_progress"
        assert body["error"]["details"]["current"]["assignee"] is not None

    # 5. Verify database state
    db.expire_all()
    fresh_item = db.query(WorkItem).filter(WorkItem.id == target_item_id).first()
    assert fresh_item.status == "in_progress"
    assert fresh_item.assignee_id is not None
    assert fresh_item.version == 2

    # Verify exactly one 'claimed' activity event exists
    claimed_events = (
        db.query(ActivityEvent)
        .filter(ActivityEvent.item_id == target_item_id, ActivityEvent.type == "claimed")
        .all()
    )
    assert len(claimed_events) == 1
    assert claimed_events[0].actor_id == fresh_item.assignee_id
