import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import User, Team, TeamMembership, WorkItem
from app.security import get_password_hash, create_access_token

client = TestClient(app)


def test_keyset_pagination_no_duplicates_or_skips(db):
    """
    Test requirement 8: Pagination.
    Keyset pagination shows no duplicates or skips even while new items are inserted between pages.
    """
    team = Team(name="Pagination Team")
    user = User(
        email=f"page_user_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Page User",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team, user])
    db.commit()
    db.refresh(team)
    db.refresh(user)

    db.add(TeamMembership(user_id=user.id, team_id=team.id, role="member"))
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Insert 10 initial items with distinct timestamps
    base_time = datetime.now(timezone.utc) - timedelta(hours=20)
    items = []
    for i in range(10):
        it = WorkItem(
            team_id=team.id,
            title=f"Initial Item {i:02d}",
            description="Testing pagination stability",
            type="task",
            status="open",
            priority=2,
            created_by=user.id,
            created_at=base_time + timedelta(minutes=i * 10),
            updated_at=base_time + timedelta(minutes=i * 10),
            last_activity_at=base_time + timedelta(minutes=i * 10),
        )
        db.add(it)
        items.append(it)
    db.commit()

    # 2. Fetch page 1 (limit=5)
    res_page1 = client.get("/items?limit=5&sort=updated", headers=headers)
    assert res_page1.status_code == 200
    page1_data = res_page1.json()
    page1_items = page1_data["items"]
    assert len(page1_items) == 5
    page1_ids = [item["id"] for item in page1_items]
    cursor = page1_data["next_cursor"]
    assert cursor is not None

    # 3. Insert NEW items at the TOP of the sort order (more recent updated_at)
    # In classic OFFSET pagination, this causes OFFSET 5 to shift and duplicate the 5th item!
    newer_time = datetime.now(timezone.utc)
    for j in range(3):
        new_it = WorkItem(
            team_id=team.id,
            title=f"Newly Inserted Item {j}",
            description="Simulating concurrent writes between page requests",
            type="task",
            status="open",
            priority=3,
            created_by=user.id,
            created_at=newer_time + timedelta(minutes=j),
            updated_at=newer_time + timedelta(minutes=j),
            last_activity_at=newer_time + timedelta(minutes=j),
        )
        db.add(new_it)
    db.commit()

    # 4. Fetch page 2 using the cursor from page 1
    res_page2 = client.get(f"/items?limit=5&sort=updated&cursor={cursor}", headers=headers)
    assert res_page2.status_code == 200
    page2_data = res_page2.json()
    page2_items = page2_data["items"]
    assert len(page2_items) == 5
    page2_ids = [item["id"] for item in page2_items]

    # 5. Assert: No duplicates between page 1 and page 2
    intersection = set(page1_ids).intersection(set(page2_ids))
    assert len(intersection) == 0, f"Found duplicate items between pages: {intersection}"

    # Assert: All 10 initial items are accounted for across page 1 and page 2 without any skips
    combined_initial = set(page1_ids).union(set(page2_ids))
    initial_ids = {it.id for it in items}
    assert combined_initial == initial_ids, "Initial items were skipped or missed!"
