"""
Central authorization policy engine.

Computes the exact set of permitted actions for a user on a given work item.
Ensures single-source-of-truth between server enforcement and client display.
"""

from typing import Set, Any
from app.workflow import get_available_transitions


def allowed_actions(role: str, item: Any, user: Any) -> Set[str]:
    """
    Calculate the set of actions permitted for (role, item, user).
    
    Allowed action tokens:
      - 'claim'
      - 'release'
      - 'assign'
      - 'edit'
      - 'change_priority'
      - 'comment'
      - 'transition:<status>'
    """
    actions: Set[str] = set()

    # Viewers can only read items; no mutating actions permitted
    if role not in ("member", "lead"):
        return actions

    is_lead = role == "lead"
    is_assignee = item.assignee_id == user.id
    is_creator = item.created_by == user.id
    is_terminal = item.status in ("closed", "cancelled")

    # 1. Claim: open + unassigned item, caller is member or lead
    if item.status == "open" and item.assignee_id is None:
        actions.add("claim")

    # 2. Release: item has an assignee, caller is the assignee or lead
    if item.assignee_id is not None and not is_terminal and (is_assignee or is_lead):
        actions.add("release")

    # 3. Assign: caller is team lead, item is not in terminal state
    if is_lead and not is_terminal:
        actions.add("assign")

    # 4. Edit (title, description, due_at): member or lead who is assignee or creator
    if not is_terminal and (is_assignee or is_creator):
        actions.add("edit")

    # 5. Change priority: assignee or lead
    if not is_terminal and (is_assignee or is_lead):
        actions.add("change_priority")

    # 6. Comment: members and leads can add comments
    actions.add("comment")

    # 7. Workflow transitions
    available_transitions = get_available_transitions(item, user, role)
    for target_status in available_transitions:
        actions.add(f"transition:{target_status}")

    return actions
