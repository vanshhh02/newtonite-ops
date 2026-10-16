"""
Declarative workflow transitions engine.

Defines all valid state transitions, role authorizations, conditions (e.g. four-eyes approval rule),
and reason requirements in a single centralized table so modifying or adding statuses is a one-place change.
"""

from dataclasses import dataclass
from typing import Callable, Optional, Set, Tuple, List, Any


@dataclass(frozen=True)
class TransitionRule:
    from_status: str
    to_status: str
    # Roles or personas permitted: 'assignee', 'lead', 'creator'
    allowed_personas: Set[str]
    # Optional condition function: (item, user, role) -> bool
    condition: Optional[Callable[[Any, Any, str], bool]] = None
    condition_description: Optional[str] = None
    requires_reason: bool = False


# Declarative transitions table
TRANSITIONS_TABLE: List[TransitionRule] = [
    # 1. From 'open'
    TransitionRule(
        from_status="open",
        to_status="in_progress",
        allowed_personas={"assignee"},
        condition=lambda item, user, role: item.assignee_id == user.id,
        condition_description="Caller must be the assigned owner of the item",
        requires_reason=False,
    ),
    TransitionRule(
        from_status="open",
        to_status="cancelled",
        allowed_personas={"lead", "creator"},
        condition=None,
        condition_description=None,
        requires_reason=False,
    ),

    # 2. From 'in_progress'
    TransitionRule(
        from_status="in_progress",
        to_status="awaiting_approval",
        allowed_personas={"assignee"},
        condition=lambda item, user, role: item.requires_approval is True and item.assignee_id == user.id,
        condition_description="Item must require approval and caller must be the assignee",
        requires_reason=False,
    ),
    TransitionRule(
        from_status="in_progress",
        to_status="resolved",
        allowed_personas={"assignee"},
        condition=lambda item, user, role: item.requires_approval is False and item.assignee_id == user.id,
        condition_description="Item cannot require approval and caller must be the assignee",
        requires_reason=False,
    ),
    TransitionRule(
        from_status="in_progress",
        to_status="cancelled",
        allowed_personas={"lead"},
        condition=None,
        condition_description=None,
        requires_reason=True,
    ),

    # 3. From 'awaiting_approval'
    TransitionRule(
        from_status="awaiting_approval",
        to_status="resolved",
        allowed_personas={"lead"},
        # Four-eyes rule: lead who is NOT the assignee
        condition=lambda item, user, role: role == "lead" and item.assignee_id != user.id,
        condition_description="Four-eyes rule: only a lead who is not the assignee may approve",
        requires_reason=False,
    ),
    TransitionRule(
        from_status="awaiting_approval",
        to_status="in_progress",
        allowed_personas={"lead"},
        condition=None,
        condition_description=None,
        requires_reason=True,  # Reject reason required
    ),
    TransitionRule(
        from_status="awaiting_approval",
        to_status="cancelled",
        allowed_personas={"lead"},
        condition=None,
        condition_description=None,
        requires_reason=True,
    ),

    # 4. From 'resolved'
    TransitionRule(
        from_status="resolved",
        to_status="closed",
        allowed_personas={"creator", "lead"},
        condition=None,
        condition_description=None,
        requires_reason=False,
    ),
    TransitionRule(
        from_status="resolved",
        to_status="in_progress",
        allowed_personas={"assignee", "lead"},
        condition=None,
        condition_description=None,
        requires_reason=True,  # Reopen reason required
    ),
]


def find_transition_rule(from_status: str, to_status: str) -> Optional[TransitionRule]:
    """Find transition rule matching from_status and to_status."""
    for rule in TRANSITIONS_TABLE:
        if rule.from_status == from_status and rule.to_status == to_status:
            return rule
    return None


def is_user_in_personas(personas: Set[str], role: str, item: Any, user: Any) -> bool:
    """Check if the user satisfies at least one persona: 'lead', 'assignee', 'creator'."""
    if "lead" in personas and role == "lead":
        return True
    if "assignee" in personas and item.assignee_id == user.id:
        return True
    if "creator" in personas and item.created_by == user.id:
        return True
    return False


def validate_transition(
    item: Any,
    to_status: str,
    user: Any,
    role: str,
    reason: Optional[str] = None,
) -> Tuple[bool, Optional[str], int]:
    """
    Validate requested transition.
    Returns: (is_valid, error_message, http_status_code)
    """
    rule = find_transition_rule(item.status, to_status)
    if not rule:
        return (
            False,
            f"Invalid transition from '{item.status}' to '{to_status}'",
            409,  # invalid_transition
        )

    # Check reason requirement
    if rule.requires_reason and (not reason or not reason.strip()):
        return (
            False,
            f"A reason is required to transition from '{item.status}' to '{to_status}'",
            422,  # validation_error
        )

    # Check persona / role permission
    if not is_user_in_personas(rule.allowed_personas, role, item, user):
        return (
            False,
            f"Role '{role}' is not authorized to transition '{item.status}' to '{to_status}'",
            403,  # forbidden
        )

    # Check condition (e.g. four-eyes approval rule)
    if rule.condition and not rule.condition(item, user, role):
        desc = rule.condition_description or "Transition condition not met"
        return (False, desc, 403)

    return (True, None, 200)


def get_available_transitions(item: Any, user: Any, role: str) -> List[str]:
    """Get list of target statuses that the user can legally transition this item into."""
    targets = []
    for rule in TRANSITIONS_TABLE:
        if rule.from_status != item.status:
            continue
        if not is_user_in_personas(rule.allowed_personas, role, item, user):
            continue
        if rule.condition and not rule.condition(item, user, role):
            continue
        targets.append(rule.to_status)
    return targets
