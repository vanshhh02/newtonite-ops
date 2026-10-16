import pytest
from types import SimpleNamespace
from fastapi.testclient import TestClient
from app.main import app
from app.policy import allowed_actions
from app.models import User, Team, TeamMembership
from app.security import get_password_hash, create_access_token

client = TestClient(app)


def test_policy_action_matrix():
    """
    Test requirement 5: role x action matrix.
    - Viewer gets empty set of allowed actions.
    - Member can claim unassigned open items, comment.
    - Assignee can release, edit, change priority, comment, transition.
    - Lead can assign, change priority, release, etc.
    """
    user_me = SimpleNamespace(id=1)
    other_user = SimpleNamespace(id=2)

    # 1. Unassigned open item
    unassigned_open_item = SimpleNamespace(
        id=10,
        status="open",
        assignee_id=None,
        created_by=other_user.id,
        requires_approval=False,
    )

    # Viewer
    viewer_actions = allowed_actions("viewer", unassigned_open_item, user_me)
    assert viewer_actions == set()  # Viewer can only read

    # Member
    member_actions = allowed_actions("member", unassigned_open_item, user_me)
    assert "claim" in member_actions
    assert "comment" in member_actions
    assert "assign" not in member_actions
    assert "release" not in member_actions
    assert "edit" not in member_actions  # Not creator or assignee

    # Lead
    lead_actions = allowed_actions("lead", unassigned_open_item, user_me)
    assert "claim" in lead_actions
    assert "assign" in lead_actions
    assert "comment" in lead_actions
    assert "transition:cancelled" in lead_actions

    # 2. In-progress item assigned to user_me
    my_active_item = SimpleNamespace(
        id=20,
        status="in_progress",
        assignee_id=user_me.id,
        created_by=user_me.id,
        requires_approval=False,
    )
    assignee_actions = allowed_actions("member", my_active_item, user_me)
    assert "release" in assignee_actions
    assert "edit" in assignee_actions
    assert "change_priority" in assignee_actions
    assert "comment" in assignee_actions
    assert "transition:resolved" in assignee_actions
    assert "assign" not in assignee_actions  # Only lead can assign


def test_auth_login_and_me(db):
    """Test /auth/login and /me endpoints."""
    # Create test user
    email = "auth_test_user@newtonite.local"
    db.query(User).filter(User.email == email).delete()
    db.commit()

    user = User(
        email=email,
        name="Auth Tester",
        password_hash=get_password_hash("password123"),
    )
    team = Team(name="Auth Test Team")
    db.add_all([user, team])
    db.commit()
    db.refresh(user)
    db.refresh(team)

    membership = TeamMembership(user_id=user.id, team_id=team.id, role="lead")
    db.add(membership)
    db.commit()

    # 1. Invalid login
    res = client.post("/auth/login", json={"email": email, "password": "wrongpassword"})
    assert res.status_code == 401
    data = res.json()
    assert data["error"]["code"] == "unauthenticated"

    # 2. Successful login
    res = client.post("/auth/login", json={"email": email, "password": "password123"})
    assert res.status_code == 200
    login_data = res.json()
    assert "access_token" in login_data
    assert login_data["user"]["email"] == email
    token = login_data["access_token"]

    # 3. GET /me with token
    headers = {"Authorization": f"Bearer {token}"}
    res_me = client.get("/me", headers=headers)
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["user"]["id"] == user.id
    assert len(me_data["memberships"]) >= 1
    assert me_data["memberships"][0]["role"] == "lead"

    # 4. GET /me without token -> 401
    res_no_auth = client.get("/me")
    assert res_no_auth.status_code == 401
    assert res_no_auth.json()["error"]["code"] == "unauthenticated"


def test_team_roster_isolation(db):
    """
    Test requirement 5:
    A user requesting members of a team they do not belong to receives 404.
    """
    # Create two separate users in separate teams
    team_a = Team(name="Team A")
    team_b = Team(name="Team B")
    user_a = User(
        email="user_a@newtonite.local",
        name="User A",
        password_hash=get_password_hash("password123"),
    )
    user_b = User(
        email="user_b@newtonite.local",
        name="User B",
        password_hash=get_password_hash("password123"),
    )
    db.add_all([team_a, team_b, user_a, user_b])
    db.commit()
    db.refresh(team_a)
    db.refresh(team_b)
    db.refresh(user_a)
    db.refresh(user_b)

    db.add(TeamMembership(user_id=user_a.id, team_id=team_a.id, role="member"))
    db.add(TeamMembership(user_id=user_b.id, team_id=team_b.id, role="member"))
    db.commit()

    token_a = create_access_token({"sub": str(user_a.id)})
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # User A accesses Team A roster -> 200
    res_own = client.get(f"/teams/{team_a.id}/members", headers=headers_a)
    assert res_own.status_code == 200
    assert len(res_own.json()) == 1

    # User A accesses Team B roster -> 404 (does NOT leak existence)
    res_foreign = client.get(f"/teams/{team_b.id}/members", headers=headers_a)
    assert res_foreign.status_code == 404
    assert res_foreign.json()["error"]["code"] == "not_found"
