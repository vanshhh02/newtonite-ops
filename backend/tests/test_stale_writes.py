import concurrent.futures
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import User, Team, TeamMembership, WorkItem
from app.security import get_password_hash, create_access_token

client = TestClient(app)


def test_concurrent_stale_writes(db):
    """
    Test requirement 2: Stale writes.
    Two concurrent PATCHes with the same expected_version ->
    one succeeds (200), one gets 409 with current; data otherwise unchanged; no lost update.
    """
    # 1. Setup team, user (lead/creator), and work item
    team = Team(name="Stale Writes Team")
    db.add(team)
    db.commit()
    db.refresh(team)

    user = User(
        email=f"stale_tester_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Stale Tester",
        password_hash=get_password_hash("password123"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(TeamMembership(user_id=user.id, team_id=team.id, role="lead"))
    db.commit()

    item = WorkItem(
        team_id=team.id,
        title="Original Baseline Title",
        description="Original Baseline Description",
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
    target_item_id = item.id

    token = create_access_token({"sub": str(user.id)})
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Prepare two competing PATCH requests both claiming expected_version = 1
    def send_patch(new_title: str):
        payload = {
            "expected_version": 1,
            "title": new_title,
        }
        res = client.patch(f"/items/{target_item_id}", json=payload, headers=headers)
        return res.status_code, res.json()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(send_patch, "Update by Thread 1")
        f2 = executor.submit(send_patch, "Update by Thread 2")
        res1 = f1.result()
        res2 = f2.result()

    results = [res1, res2]
    status_codes = [r[0] for r in results]

    assert 200 in status_codes, "Expected one successful update (200)"
    assert 409 in status_codes, "Expected one optimistic version conflict (409)"

    # Inspect the 409 conflict
    conflict_body = [r[1] for r in results if r[0] == 409][0]
    assert conflict_body["error"]["code"] == "version_conflict"
    current_data = conflict_body["error"]["details"]["current"]
    assert current_data["version"] == 2
    assert current_data["title"] in ["Update by Thread 1", "Update by Thread 2"]

    # 3. Verify final DB state has version 2 and no corrupted or lost updates
    db.expire_all()
    final_item = db.query(WorkItem).filter(WorkItem.id == target_item_id).first()
    assert final_item.version == 2
    assert final_item.title in ["Update by Thread 1", "Update by Thread 2"]
