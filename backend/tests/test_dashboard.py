import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import User, Team, TeamMembership, WorkItem
from app.security import get_password_hash, create_access_token

client = TestClient(app)


def test_dashboard_summary_metrics(db):
    """
    Test dashboard summary endpoint:
    - assigned_to_me
    - unassigned_urgent
    - awaiting_my_approval (four-eyes: caller is lead but not assignee)
    - overdue
    - stale
    - isolation from other teams
    """
    # 1. Setup teams & users
    team1 = Team(name="Dash Team 1")
    team2 = Team(name="Dash Team 2 (Other)")
    lead_user = User(
        email=f"dash_lead_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Dashboard Lead",
        password_hash=get_password_hash("password123"),
    )
    other_member = User(
        email=f"dash_member_{uuid.uuid4().hex[:6]}@newtonite.local",
        name="Dashboard Member",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team1, team2, lead_user, other_member])
    db.commit()
    db.refresh(team1)
    db.refresh(team2)
    db.refresh(lead_user)
    db.refresh(other_member)

    # Lead user is lead in team1, other_member is member in team1 and team2
    db.add(TeamMembership(user_id=lead_user.id, team_id=team1.id, role="lead"))
    db.add(TeamMembership(user_id=other_member.id, team_id=team1.id, role="member"))
    db.add(TeamMembership(user_id=other_member.id, team_id=team2.id, role="member"))
    db.commit()

    now = datetime.now(timezone.utc)

    # 2. Populate specific metric items in Team 1
    # Item A: Assigned to lead_user, active
    item_a = WorkItem(
        team_id=team1.id,
        title="Assigned to me item",
        description="...",
        type="task",
        status="in_progress",
        priority=2,
        assignee_id=lead_user.id,
        created_by=lead_user.id,
    )
    # Item B: Unassigned urgent
    item_b = WorkItem(
        team_id=team1.id,
        title="Urgent unassigned item",
        description="...",
        type="incident",
        status="open",
        priority=4,  # Urgent
        assignee_id=None,
        created_by=other_member.id,
    )
    # Item C: Awaiting approval assigned to other_member (Lead can approve -> four-eyes rule satisfied)
    item_c = WorkItem(
        team_id=team1.id,
        title="Approval item for lead",
        description="...",
        type="payment",
        status="awaiting_approval",
        priority=3,
        requires_approval=True,
        assignee_id=other_member.id,
        created_by=other_member.id,
    )
    # Item D: Awaiting approval assigned to lead_user (Lead CANNOT approve own item -> excluded from awaiting_my_approval)
    item_d = WorkItem(
        team_id=team1.id,
        title="Approval item assigned to lead himself",
        description="...",
        type="payment",
        status="awaiting_approval",
        priority=3,
        requires_approval=True,
        assignee_id=lead_user.id,
        created_by=lead_user.id,
    )
    # Item E: Overdue item (due in the past, active)
    item_e = WorkItem(
        team_id=team1.id,
        title="Overdue item",
        description="...",
        type="task",
        status="open",
        priority=1,
        due_at=now - timedelta(days=2),
        created_by=other_member.id,
    )
    # Item F: Stale item (in_progress, last_activity_at > 72 hours ago)
    item_f = WorkItem(
        team_id=team1.id,
        title="Stale item",
        description="...",
        type="task",
        status="in_progress",
        priority=2,
        assignee_id=other_member.id,
        created_by=other_member.id,
        last_activity_at=now - timedelta(hours=80),
    )
    # Item G: Belongs to Team 2 (foreign to lead_user -> must NOT count in lead_user dashboard)
    item_g = WorkItem(
        team_id=team2.id,
        title="Team 2 Foreign Item",
        description="...",
        type="incident",
        status="open",
        priority=4,
        assignee_id=None,
        created_by=other_member.id,
    )

    db.add_all([item_a, item_b, item_c, item_d, item_e, item_f, item_g])
    db.commit()

    token_lead = create_access_token({"sub": str(lead_user.id)})
    headers_lead = {"Authorization": f"Bearer {token_lead}"}

    res = client.get("/dashboard/summary", headers=headers_lead)
    assert res.status_code == 200
    counts = res.json()["counts"]

    # Verify each counter:
    # assigned_to_me: item_a and item_d (both assigned to lead_user and active) -> 2
    assert counts["assigned_to_me"] == 2

    # unassigned_urgent: item_b (open, no assignee, priority=urgent, team1) -> 1
    assert counts["unassigned_urgent"] == 1

    # awaiting_my_approval: item_c only (item_d is assigned to lead_user, four-eyes rule excludes it) -> 1
    assert counts["awaiting_my_approval"] == 1

    # overdue: item_e (due_at < now, active) -> 1
    assert counts["overdue"] == 1

    # stale: item_f (last_activity_at > 72h ago, in_progress) -> 1
    assert counts["stale"] == 1
