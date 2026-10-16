import pytest
from types import SimpleNamespace
from app.workflow import validate_transition, get_available_transitions


def test_workflow_invalid_transition_rejected():
    """Invalid jumps (e.g., open -> closed directly) must be rejected with 409."""
    item = SimpleNamespace(
        id=1,
        status="open",
        assignee_id=None,
        created_by=2,
        requires_approval=False,
    )
    user = SimpleNamespace(id=2)
    role = "lead"

    valid, msg, code = validate_transition(item, to_status="closed", user=user, role=role)
    assert not valid
    assert code == 409
    assert "Invalid transition" in msg


def test_workflow_approval_requires_lead_and_four_eyes():
    """
    Test requirement 4:
    - Non-lead approval rejected (403).
    - Assignee cannot approve their own item (four-eyes rule) even if lead (403).
    - Lead who is NOT the assignee can approve (200).
    """
    lead_and_assignee = SimpleNamespace(id=10)
    other_lead = SimpleNamespace(id=20)
    regular_member = SimpleNamespace(id=30)

    item = SimpleNamespace(
        id=1,
        status="awaiting_approval",
        assignee_id=10,  # Assigned to lead_and_assignee
        created_by=10,
        requires_approval=True,
    )

    # 1. Regular member tries to approve -> rejected 403
    valid, msg, code = validate_transition(
        item, to_status="resolved", user=regular_member, role="member"
    )
    assert not valid
    assert code == 403

    # 2. Lead who IS the assignee tries to approve own item -> rejected 403 (four-eyes rule)
    valid, msg, code = validate_transition(
        item, to_status="resolved", user=lead_and_assignee, role="lead"
    )
    assert not valid
    assert code == 403
    assert "four-eyes" in msg.lower()

    # 3. Another lead who is NOT the assignee approves -> succeeds 200
    valid, msg, code = validate_transition(
        item, to_status="resolved", user=other_lead, role="lead"
    )
    assert valid
    assert code == 200


def test_workflow_requires_approval_path():
    """
    Items with requires_approval=True must go to awaiting_approval, not resolved directly.
    Items with requires_approval=False go directly to resolved.
    """
    assignee = SimpleNamespace(id=10)

    # Item with requires_approval=True
    approval_item = SimpleNamespace(
        id=1,
        status="in_progress",
        assignee_id=10,
        created_by=10,
        requires_approval=True,
    )
    # Direct to resolved must fail condition
    valid, _, code = validate_transition(
        approval_item, to_status="resolved", user=assignee, role="member"
    )
    assert not valid
    assert code == 403

    # To awaiting_approval must succeed
    valid, _, code = validate_transition(
        approval_item, to_status="awaiting_approval", user=assignee, role="member"
    )
    assert valid
    assert code == 200

    # Item with requires_approval=False
    standard_item = SimpleNamespace(
        id=2,
        status="in_progress",
        assignee_id=10,
        created_by=10,
        requires_approval=False,
    )
    # Direct to resolved must succeed
    valid, _, code = validate_transition(
        standard_item, to_status="resolved", user=assignee, role="member"
    )
    assert valid
    assert code == 200


def test_workflow_rejection_and_reopen_require_reason():
    """
    Reason is strictly required for:
    - awaiting_approval -> in_progress (rejection)
    - in_progress -> cancelled
    - resolved -> in_progress (reopen)
    Missing reason returns 422.
    """
    lead = SimpleNamespace(id=20)
    assignee = SimpleNamespace(id=10)

    # 1. Rejection without reason -> 422
    item_awaiting = SimpleNamespace(
        id=1, status="awaiting_approval", assignee_id=10, created_by=10, requires_approval=True
    )
    valid, msg, code = validate_transition(
        item_awaiting, to_status="in_progress", user=lead, role="lead", reason=""
    )
    assert not valid
    assert code == 422
    assert "reason is required" in msg.lower()

    # Rejection with reason -> 200
    valid, _, code = validate_transition(
        item_awaiting, to_status="in_progress", user=lead, role="lead", reason="Missing budget code"
    )
    assert valid
    assert code == 200

    # 2. Cancel from in_progress without reason -> 422
    item_in_prog = SimpleNamespace(
        id=2, status="in_progress", assignee_id=10, created_by=10, requires_approval=False
    )
    valid, msg, code = validate_transition(
        item_in_prog, to_status="cancelled", user=lead, role="lead", reason=None
    )
    assert not valid
    assert code == 422

    # Cancel with reason -> 200
    valid, _, code = validate_transition(
        item_in_prog, to_status="cancelled", user=lead, role="lead", reason="Duplicate incident"
    )
    assert valid
    assert code == 200

    # 3. Reopen from resolved without reason -> 422
    item_resolved = SimpleNamespace(
        id=3, status="resolved", assignee_id=10, created_by=10, requires_approval=False
    )
    valid, msg, code = validate_transition(
        item_resolved, to_status="in_progress", user=assignee, role="member", reason="   "
    )
    assert not valid
    assert code == 422

    # Reopen with reason -> 200
    valid, _, code = validate_transition(
        item_resolved, to_status="in_progress", user=assignee, role="member", reason="Issue reoccurred"
    )
    assert valid
    assert code == 200


def test_workflow_terminal_statuses():
    """Closed and cancelled are terminal statuses with no transitions."""
    user = SimpleNamespace(id=1)
    for terminal_status in ["closed", "cancelled"]:
        item = SimpleNamespace(
            id=1, status=terminal_status, assignee_id=1, created_by=1, requires_approval=False
        )
        avail = get_available_transitions(item, user, "lead")
        assert len(avail) == 0

        valid, _, code = validate_transition(item, "open", user, "lead")
        assert not valid
        assert code == 409
