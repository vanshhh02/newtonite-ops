import base64
import json
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Tuple
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy import text, func, and_, or_
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models import (
    User,
    WorkItem,
    TeamMembership,
    ActivityEvent,
    Outbox,
    PRIORITY_STR_TO_INT,
    PRIORITY_INT_TO_STR,
)
from app.schemas import (
    Item,
    ItemSummary,
    ItemListResponse,
    ItemCreateRequest,
    ItemPatchRequest,
    ItemClaimRequest,
    ItemReleaseRequest,
    ItemAssignRequest,
    ItemTransitionRequest,
    ItemCommentRequest,
    EventOut,
    EventListResponse,
    UserRef,
)
from app.exceptions import AppException
from app.deps import get_current_user, get_item_and_role
from app.policy import allowed_actions
from app.workflow import validate_transition
from app.idempotency import (
    validate_idempotency_key_header,
    canonical_hash,
    check_idempotent_replay,
    record_idempotent_response,
    commit_or_replay,
)
from app.config import settings

router = APIRouter(tags=["items"])


def serialize_item_dict(item: WorkItem, user: User, role: str) -> dict[str, Any]:
    """Serialize WorkItem to full Item response matching API contract."""
    actions = sorted(list(allowed_actions(role, item, user)))
    return {
        "id": item.id,
        "key": item.key,
        "team_id": item.team_id,
        "team_name": item.team.name if item.team else "",
        "title": item.title,
        "description": item.description,
        "type": item.type,
        "status": item.status,
        "priority": item.priority_name,
        "assignee": (
            {"id": item.assignee.id, "name": item.assignee.name}
            if item.assignee
            else None
        ),
        "created_by": (
            {"id": item.creator.id, "name": item.creator.name}
            if item.creator
            else {"id": item.created_by, "name": ""}
        ),
        "requires_approval": item.requires_approval,
        "due_at": item.due_at.isoformat() if item.due_at else None,
        "version": item.version,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
        "last_activity_at": item.last_activity_at.isoformat(),
        "allowed_actions": actions,
    }


def serialize_item_summary_dict(item: WorkItem) -> dict[str, Any]:
    """Serialize WorkItem to ItemSummary response (omits description & allowed_actions)."""
    return {
        "id": item.id,
        "key": item.key,
        "team_id": item.team_id,
        "team_name": item.team.name if item.team else "",
        "title": item.title,
        "type": item.type,
        "status": item.status,
        "priority": item.priority_name,
        "assignee": (
            {"id": item.assignee.id, "name": item.assignee.name}
            if item.assignee
            else None
        ),
        "created_by": (
            {"id": item.creator.id, "name": item.creator.name}
            if item.creator
            else {"id": item.created_by, "name": ""}
        ),
        "requires_approval": item.requires_approval,
        "due_at": item.due_at.isoformat() if item.due_at else None,
        "version": item.version,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
        "last_activity_at": item.last_activity_at.isoformat(),
    }


def serialize_event_dict(event: ActivityEvent) -> dict[str, Any]:
    """Serialize ActivityEvent to Event response."""
    return {
        "id": event.id,
        "item_id": event.item_id,
        "type": event.type,
        "actor": {
            "id": event.actor.id if event.actor else event.actor_id,
            "name": event.actor.name if event.actor else "",
        },
        "payload": event.payload,
        "created_at": event.created_at.isoformat(),
    }


def encode_cursor(sort_val: Any, item_id: int) -> str:
    """Encode keyset cursor as opaque base64 string."""
    v_str = sort_val.isoformat() if hasattr(sort_val, "isoformat") else sort_val
    raw = json.dumps({"v": v_str, "id": item_id}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def decode_cursor(cursor_str: str) -> Tuple[Any, int]:
    """Decode base64 keyset cursor."""
    try:
        raw = base64.urlsafe_b64decode(cursor_str.encode("utf-8"))
        payload = json.loads(raw.decode("utf-8"))
        return payload["v"], payload["id"]
    except Exception:
        raise AppException(
            status_code=422,
            code="validation_error",
            message="Invalid pagination cursor format",
            details={"fields": [{"field": "cursor", "message": "Malformed cursor"}]},
        )


@router.post("/items")
async def create_item(
    request: Request,
    body: ItemCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a new work item.
    Requires Idempotency-Key header.
    Caller must be member or lead of the target team (viewers cannot write).
    """
    key = validate_idempotency_key_header(idempotency_key)
    raw_body = await request.body()
    req_hash = canonical_hash(raw_body)

    # 1. Check idempotency replay
    replay = check_idempotent_replay(db, current_user.id, key, req_hash)
    if replay:
        status_code, resp_data = replay
        return Response(
            content=json.dumps(resp_data),
            status_code=status_code,
            media_type="application/json",
            headers={"Idempotent-Replay": "true"},
        )

    # 2. Check team membership and role permissions
    membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == body.team_id,
        )
        .first()
    )
    if not membership:
        raise AppException(
            status_code=404,
            code="not_found",
            message="Team not found",
        )
    if membership.role == "viewer":
        raise AppException(
            status_code=403,
            code="forbidden",
            message="Viewers are not permitted to create items",
        )

    # 3. Resolve approval requirement defaults
    requires_approval = body.requires_approval
    if requires_approval is None:
        requires_approval = body.type in ("payment", "compliance")

    priority_int = PRIORITY_STR_TO_INT.get(body.priority, 2)

    # 4. Atomic transaction: create item + initial event + idempotency row
    new_item = WorkItem(
        team_id=body.team_id,
        title=body.title,
        description=body.description,
        type=body.type,
        status="open",
        priority=priority_int,
        assignee_id=None,
        created_by=current_user.id,
        requires_approval=requires_approval,
        due_at=body.due_at,
        version=1,
    )
    db.add(new_item)
    db.flush()  # Allocate new_item.id

    # Create append-only initial activity event
    event = ActivityEvent(
        item_id=new_item.id,
        actor_id=current_user.id,
        type="created",
        payload={"initial_status": "open"},
    )
    db.add(event)

    db.refresh(new_item)
    response_payload = serialize_item_dict(new_item, current_user, membership.role)

    # Record 200 response in idempotency_keys within the same transaction
    record_idempotent_response(
        db,
        current_user.id,
        key,
        req_hash,
        200,
        response_payload,
    )

    status_code, final_payload, is_replay = commit_or_replay(
        db, current_user.id, key, req_hash, 200, response_payload
    )
    headers = {"Idempotent-Replay": "true"} if is_replay else {}
    return Response(
        content=json.dumps(final_payload),
        status_code=status_code,
        media_type="application/json",
        headers=headers,
    )


@router.get("/items", response_model=ItemListResponse)
def list_items(
    view: str = Query("all", pattern="^(assigned_to_me|unassigned_urgent|awaiting_my_approval|overdue|stale|all)$"),
    team_id: Optional[int] = None,
    type: Optional[List[str]] = Query(None),
    status: Optional[List[str]] = Query(None),
    priority: Optional[List[str]] = Query(None),
    assignee: Optional[str] = None,
    q: Optional[str] = None,
    sort: str = Query("updated", pattern="^(updated|priority|due)$"),
    cursor: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List work items with keyset (cursor) pagination, full-text search, and multi-dimensional filters.
    Strictly scoped to caller's team memberships in SQL.
    """
    # 1. Fetch caller's team memberships
    user_memberships = (
        db.query(TeamMembership)
        .filter(TeamMembership.user_id == current_user.id)
        .all()
    )
    if not user_memberships:
        return ItemListResponse(items=[], next_cursor=None)

    caller_team_ids = [m.team_id for m in user_memberships]
    caller_lead_team_ids = [m.team_id for m in user_memberships if m.role == "lead"]

    # Filter by specific team if requested
    if team_id is not None:
        if team_id not in caller_team_ids:
            return ItemListResponse(items=[], next_cursor=None)
        allowed_teams = [team_id]
    else:
        allowed_teams = caller_team_ids

    # 2. Build base query with eager-loaded relations
    query = (
        db.query(WorkItem)
        .options(
            joinedload(WorkItem.team),
            joinedload(WorkItem.assignee),
            joinedload(WorkItem.creator),
        )
        .filter(WorkItem.team_id.in_(allowed_teams))
    )

    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(hours=settings.STALE_AFTER_HOURS)

    # 3. Apply View predicates
    if view == "assigned_to_me":
        query = query.filter(
            WorkItem.assignee_id == current_user.id,
            WorkItem.status.in_(["open", "in_progress", "awaiting_approval"]),
        )
    elif view == "unassigned_urgent":
        query = query.filter(
            WorkItem.assignee_id.is_(None),
            WorkItem.status == "open",
            WorkItem.priority == 4,  # urgent
        )
    elif view == "awaiting_my_approval":
        # Caller must be lead of that team AND four-eyes rule (not the assignee)
        if not caller_lead_team_ids:
            return ItemListResponse(items=[], next_cursor=None)
        query = query.filter(
            WorkItem.status == "awaiting_approval",
            WorkItem.team_id.in_(caller_lead_team_ids),
            or_(
                WorkItem.assignee_id.is_(None),
                WorkItem.assignee_id != current_user.id,
            ),
        )
    elif view == "overdue":
        query = query.filter(
            WorkItem.due_at.isnot(None),
            WorkItem.due_at < now,
            WorkItem.status.in_(["open", "in_progress", "awaiting_approval"]),
        )
    elif view == "stale":
        query = query.filter(
            WorkItem.status.in_(["in_progress", "awaiting_approval"]),
            WorkItem.last_activity_at < stale_threshold,
        )

    # 4. Multi-value filters
    if type:
        query = query.filter(WorkItem.type.in_(type))
    if status:
        query = query.filter(WorkItem.status.in_(status))
    if priority:
        priority_ints = [PRIORITY_STR_TO_INT[p] for p in priority if p in PRIORITY_STR_TO_INT]
        if priority_ints:
            query = query.filter(WorkItem.priority.in_(priority_ints))

    # Assignee filter
    if assignee:
        if assignee == "me":
            query = query.filter(WorkItem.assignee_id == current_user.id)
        elif assignee == "unassigned":
            query = query.filter(WorkItem.assignee_id.is_(None))
        else:
            try:
                target_user_id = int(assignee)
                query = query.filter(WorkItem.assignee_id == target_user_id)
            except ValueError:
                raise AppException(
                    status_code=422,
                    code="validation_error",
                    message="Invalid assignee parameter",
                )

    # Full-text websearch query
    if q and q.strip():
        # Match using PostgreSQL websearch_to_tsquery against generated search_vector
        query = query.filter(
            WorkItem.search_vector.op("@@")(func.websearch_to_tsquery("english", q.strip()))
        )

    # 5. Keyset (Cursor) Pagination & Sorting
    cursor_v, cursor_id = None, None
    if cursor:
        cursor_v, cursor_id = decode_cursor(cursor)

    if sort == "updated":
        # Order by updated_at DESC, id DESC
        if cursor_v is not None and cursor_id is not None:
            c_dt = datetime.fromisoformat(cursor_v) if isinstance(cursor_v, str) else cursor_v
            query = query.filter(
                or_(
                    WorkItem.updated_at < c_dt,
                    and_(WorkItem.updated_at == c_dt, WorkItem.id < cursor_id),
                )
            )
        query = query.order_by(WorkItem.updated_at.desc(), WorkItem.id.desc())

    elif sort == "priority":
        # Order by priority DESC, id DESC
        if cursor_v is not None and cursor_id is not None:
            c_pri = int(cursor_v)
            query = query.filter(
                or_(
                    WorkItem.priority < c_pri,
                    and_(WorkItem.priority == c_pri, WorkItem.id < cursor_id),
                )
            )
        query = query.order_by(WorkItem.priority.desc(), WorkItem.id.desc())

    elif sort == "due":
        # Order by due_at ASC NULLS LAST, id ASC
        if cursor_v is not None and cursor_id is not None:
            if cursor_v == "null" or cursor_v is None:
                query = query.filter(
                    WorkItem.due_at.is_(None),
                    WorkItem.id > cursor_id,
                )
            else:
                c_due = datetime.fromisoformat(cursor_v) if isinstance(cursor_v, str) else cursor_v
                query = query.filter(
                    or_(
                        WorkItem.due_at > c_due,
                        and_(WorkItem.due_at == c_due, WorkItem.id > cursor_id),
                        WorkItem.due_at.is_(None),
                    )
                )
        query = query.order_by(WorkItem.due_at.asc().nullslast(), WorkItem.id.asc())

    # Fetch limit + 1 to detect next page existence
    rows = query.limit(limit + 1).all()

    has_next = len(rows) > limit
    page_items = rows[:limit]

    next_cursor = None
    if has_next and page_items:
        last_item = page_items[-1]
        if sort == "updated":
            next_cursor = encode_cursor(last_item.updated_at, last_item.id)
        elif sort == "priority":
            next_cursor = encode_cursor(last_item.priority, last_item.id)
        elif sort == "due":
            next_cursor = encode_cursor(
                last_item.due_at.isoformat() if last_item.due_at else None,
                last_item.id,
            )

    return ItemListResponse(
        items=[serialize_item_summary_dict(item) for item in page_items],
        next_cursor=next_cursor,
    )


@router.get("/items/{id}")
def get_item_detail(
    id: int,
    item_and_role: Tuple[WorkItem, str] = Depends(get_item_and_role),
    current_user: User = Depends(get_current_user),
):
    """
    Get full work item detail including description and computed allowed_actions.
    Returns 404 if caller is not a member of the item's team.
    """
    item, role = item_and_role
    return serialize_item_dict(item, current_user, role)


@router.patch("/items/{id}")
def patch_item(
    id: int,
    body: ItemPatchRequest,
    item_and_role: Tuple[WorkItem, str] = Depends(get_item_and_role),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update item fields with optimistic concurrency control.
    Fails with 409 version_conflict if expected_version doesn't match current state.
    """
    item, role = item_and_role

    # 1. Optimistic version check against loaded row
    if item.version != body.expected_version:
        raise AppException(
            status_code=409,
            code="version_conflict",
            message="Work item was modified by another operation",
            details={"current": serialize_item_dict(item, current_user, role)},
        )

    # 2. Authorization check
    is_assignee = item.assignee_id == current_user.id
    is_creator = item.created_by == current_user.id
    is_lead = role == "lead"

    # Priority change authorization
    if body.priority is not None:
        if not (is_assignee or is_lead):
            raise AppException(
                status_code=403,
                code="forbidden",
                message="Only assignee or lead may change priority",
            )

    # Title / description / due_at change authorization
    other_fields_requested = (
        body.title is not None
        or body.description is not None
        or body.due_at is not None
    )
    if other_fields_requested:
        if not (is_assignee or is_creator):
            raise AppException(
                status_code=403,
                code="forbidden",
                message="Only assignee or creator may edit title/description/due_at",
            )

    # 3. Execute conditional UPDATE with version increment
    new_priority_int = (
        PRIORITY_STR_TO_INT.get(body.priority, item.priority)
        if body.priority is not None
        else item.priority
    )
    new_title = body.title if body.title is not None else item.title
    new_description = body.description if body.description is not None else item.description
    new_due_at = body.due_at if "due_at" in body.model_fields_set else item.due_at

    result = db.execute(
        text("""
        UPDATE work_items
        SET title = :title,
            description = :description,
            priority = :priority,
            due_at = :due_at,
            version = version + 1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = :id AND version = :expected_version
        RETURNING *;
        """),
        {
            "id": item.id,
            "expected_version": body.expected_version,
            "title": new_title,
            "description": new_description,
            "priority": new_priority_int,
            "due_at": new_due_at,
        },
    )

    if result.rowcount == 0:
        # Concurrent stale write conflict
        db.rollback()
        fresh = db.query(WorkItem).filter(WorkItem.id == item.id).first()
        raise AppException(
            status_code=409,
            code="version_conflict",
            message="Work item was modified by another operation",
            details={"current": serialize_item_dict(fresh, current_user, role)},
        )

    # 4. Record activity events for changes
    if body.priority is not None and new_priority_int != item.priority:
        db.add(ActivityEvent(
            item_id=item.id,
            actor_id=current_user.id,
            type="priority_changed",
            payload={"from": item.priority_name, "to": body.priority},
        ))

    edited_fields = []
    if body.title is not None and body.title != item.title:
        edited_fields.append("title")
    if body.description is not None and body.description != item.description:
        edited_fields.append("description")
    if "due_at" in body.model_fields_set and body.due_at != item.due_at:
        edited_fields.append("due_at")

    if edited_fields:
        db.add(ActivityEvent(
            item_id=item.id,
            actor_id=current_user.id,
            type="edited",
            payload={"fields": edited_fields},
        ))

    db.commit()
    db.refresh(item)
    return serialize_item_dict(item, current_user, role)


@router.post("/items/{id}/claim")
async def claim_item(
    id: int,
    request: Request,
    body: ItemClaimRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Atomic Claim via single conditional UPDATE:
    UPDATE work_items SET assignee_id = caller, status = 'in_progress', version = version + 1
    WHERE id = :id AND assignee_id IS NULL AND status = 'open'

    No read-then-write race window. Loser gets 409 already_claimed with fresh Item.
    """
    key = validate_idempotency_key_header(idempotency_key)
    raw_body = await request.body()
    req_hash = canonical_hash(raw_body)

    # 1. Idempotency replay check
    replay = check_idempotent_replay(db, current_user.id, key, req_hash)
    if replay:
        status_code, resp_data = replay
        return Response(
            content=json.dumps(resp_data),
            status_code=status_code,
            media_type="application/json",
            headers={"Idempotent-Replay": "true"},
        )

    # 2. Check team membership (404 if not found, 403 if viewer)
    membership = (
        db.query(TeamMembership, WorkItem)
        .join(WorkItem, WorkItem.team_id == TeamMembership.team_id)
        .filter(
            TeamMembership.user_id == current_user.id,
            WorkItem.id == id,
        )
        .first()
    )
    if not membership:
        raise AppException(
            status_code=404,
            code="not_found",
            message="Work item not found",
        )
    team_membership, _ = membership
    if team_membership.role not in ("member", "lead"):
        raise AppException(
            status_code=403,
            code="forbidden",
            message="Viewers cannot claim work items",
        )

    # 3. Atomic single-statement conditional UPDATE
    result = db.execute(
        text("""
        UPDATE work_items
        SET assignee_id = :caller_id,
            status = 'in_progress',
            version = version + 1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = :id AND assignee_id IS NULL AND status = 'open'
        RETURNING *;
        """),
        {"id": id, "caller_id": current_user.id},
    )

    if result.rowcount == 0:
        # Atomic claim race lost or item is not in claimable state
        db.rollback()
        fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
        raise AppException(
            status_code=409,
            code="already_claimed",
            message="Work item has already been claimed or is no longer open",
            details={"current": serialize_item_dict(fresh, current_user, team_membership.role)},
        )

    # 4. Insert claimed activity event
    db.add(ActivityEvent(
        item_id=id,
        actor_id=current_user.id,
        type="claimed",
        payload={},
    ))

    # Commit and return fresh item
    db.flush()
    fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
    response_payload = serialize_item_dict(fresh, current_user, team_membership.role)

    status_code, final_payload, is_replay = commit_or_replay(
        db, current_user.id, key, req_hash, 200, response_payload
    )
    headers = {"Idempotent-Replay": "true"} if is_replay else {}
    return Response(
        content=json.dumps(final_payload),
        status_code=status_code,
        media_type="application/json",
        headers=headers,
    )


@router.post("/items/{id}/release")
async def release_item(
    id: int,
    request: Request,
    body: ItemReleaseRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Release work item back to unassigned open state.
    Permitted for assignee or lead.
    """
    key = validate_idempotency_key_header(idempotency_key)
    raw_body = await request.body()
    req_hash = canonical_hash(raw_body)

    replay = check_idempotent_replay(db, current_user.id, key, req_hash)
    if replay:
        status_code, resp_data = replay
        return Response(
            content=json.dumps(resp_data),
            status_code=status_code,
            media_type="application/json",
            headers={"Idempotent-Replay": "true"},
        )

    # Load item and verify membership
    item = db.query(WorkItem).filter(WorkItem.id == id).first()
    if not item:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == item.team_id,
        )
        .first()
    )
    if not membership:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    # Only assignee or lead can release
    is_assignee = item.assignee_id == current_user.id
    is_lead = membership.role == "lead"
    if not (is_assignee or is_lead):
        raise AppException(
            status_code=403,
            code="forbidden",
            message="Only the assignee or a lead may release an item",
        )

    # Optimistic concurrency check
    result = db.execute(
        text("""
        UPDATE work_items
        SET assignee_id = NULL,
            status = 'open',
            version = version + 1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = :id AND version = :expected_version
        RETURNING *;
        """),
        {"id": id, "expected_version": body.expected_version},
    )

    if result.rowcount == 0:
        db.rollback()
        fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
        raise AppException(
            status_code=409,
            code="version_conflict",
            message="Work item was modified by another operation",
            details={"current": serialize_item_dict(fresh, current_user, membership.role)},
        )

    db.add(ActivityEvent(
        item_id=id,
        actor_id=current_user.id,
        type="released",
        payload={},
    ))

    db.flush()
    fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
    response_payload = serialize_item_dict(fresh, current_user, membership.role)

    status_code, final_payload, is_replay = commit_or_replay(
        db, current_user.id, key, req_hash, 200, response_payload
    )
    headers = {"Idempotent-Replay": "true"} if is_replay else {}
    return Response(
        content=json.dumps(final_payload),
        status_code=status_code,
        media_type="application/json",
        headers=headers,
    )


@router.post("/items/{id}/assign")
async def assign_item(
    id: int,
    request: Request,
    body: ItemAssignRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Assign or reassign an item to a team member.
    Permitted for team leads only. Target assignee must be member or lead of that team.
    Writes outbox entry if assigned to someone else.
    """
    key = validate_idempotency_key_header(idempotency_key)
    raw_body = await request.body()
    req_hash = canonical_hash(raw_body)

    replay = check_idempotent_replay(db, current_user.id, key, req_hash)
    if replay:
        status_code, resp_data = replay
        return Response(
            content=json.dumps(resp_data),
            status_code=status_code,
            media_type="application/json",
            headers={"Idempotent-Replay": "true"},
        )

    item = db.query(WorkItem).filter(WorkItem.id == id).first()
    if not item:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == item.team_id,
        )
        .first()
    )
    if not membership:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    if membership.role != "lead":
        raise AppException(
            status_code=403,
            code="forbidden",
            message="Only team leads may assign or reassign items",
        )

    # Validate target assignee belongs to the team as member or lead
    if body.assignee_id is not None:
        target_mem = (
            db.query(TeamMembership)
            .filter(
                TeamMembership.user_id == body.assignee_id,
                TeamMembership.team_id == item.team_id,
            )
            .first()
        )
        if not target_mem or target_mem.role not in ("member", "lead"):
            raise AppException(
                status_code=422,
                code="validation_error",
                message="Target assignee must be an active member or lead of this team",
                details={"fields": [{"field": "assignee_id", "message": "User not in team"}]},
            )

    old_assignee_id = item.assignee_id

    # Optimistic conditional UPDATE
    result = db.execute(
        text("""
        UPDATE work_items
        SET assignee_id = :assignee_id,
            version = version + 1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = :id AND version = :expected_version
        RETURNING *;
        """),
        {
            "id": id,
            "assignee_id": body.assignee_id,
            "expected_version": body.expected_version,
        },
    )

    if result.rowcount == 0:
        db.rollback()
        fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
        raise AppException(
            status_code=409,
            code="version_conflict",
            message="Work item was modified by another operation",
            details={"current": serialize_item_dict(fresh, current_user, membership.role)},
        )

    # Activity event: assigned
    event = ActivityEvent(
        item_id=id,
        actor_id=current_user.id,
        type="assigned",
        payload={"from": old_assignee_id, "to": body.assignee_id},
    )
    db.add(event)
    db.flush()

    # Outbox notification if assigned to another user
    if body.assignee_id is not None and body.assignee_id != current_user.id:
        outbox_entry = Outbox(
            type="item_assigned",
            payload={
                "event_id": event.id,
                "item_id": id,
                "item_key": f"OPS-{id}",
                "recipient_id": body.assignee_id,
                "actor_id": current_user.id,
                "message": f"{current_user.name} assigned OPS-{id} to you",
            },
        )
        db.add(outbox_entry)

    fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
    response_payload = serialize_item_dict(fresh, current_user, membership.role)

    status_code, final_payload, is_replay = commit_or_replay(
        db, current_user.id, key, req_hash, 200, response_payload
    )
    headers = {"Idempotent-Replay": "true"} if is_replay else {}
    return Response(
        content=json.dumps(final_payload),
        status_code=status_code,
        media_type="application/json",
        headers=headers,
    )


@router.post("/items/{id}/transition")
async def transition_item(
    id: int,
    request: Request,
    body: ItemTransitionRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Transition item status with workflow rule and persona validation.
    Enforces four-eyes approval rule and required reasons.
    Writes outbox entry for awaiting_approval or resolved transitions.
    """
    key = validate_idempotency_key_header(idempotency_key)
    raw_body = await request.body()
    req_hash = canonical_hash(raw_body)

    replay = check_idempotent_replay(db, current_user.id, key, req_hash)
    if replay:
        status_code, resp_data = replay
        return Response(
            content=json.dumps(resp_data),
            status_code=status_code,
            media_type="application/json",
            headers={"Idempotent-Replay": "true"},
        )

    item = db.query(WorkItem).filter(WorkItem.id == id).first()
    if not item:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == item.team_id,
        )
        .first()
    )
    if not membership:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    # Validate transition against declarative workflow engine
    valid, err_msg, err_code = validate_transition(
        item=item,
        to_status=body.to_status,
        user=current_user,
        role=membership.role,
        reason=body.reason,
    )
    if not valid:
        if err_code == 409:
            raise AppException(
                status_code=409,
                code="invalid_transition",
                message=err_msg or "Invalid transition",
                details={"current": serialize_item_dict(item, current_user, membership.role)},
            )
        elif err_code == 422:
            raise AppException(
                status_code=422,
                code="validation_error",
                message=err_msg or "Validation error",
                details={"fields": [{"field": "reason", "message": err_msg}]},
            )
        else:
            raise AppException(
                status_code=403,
                code="forbidden",
                message=err_msg or "Forbidden transition",
            )

    old_status = item.status

    # Optimistic conditional UPDATE
    result = db.execute(
        text("""
        UPDATE work_items
        SET status = :to_status,
            version = version + 1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = :id AND version = :expected_version
        RETURNING *;
        """),
        {
            "id": id,
            "to_status": body.to_status,
            "expected_version": body.expected_version,
        },
    )

    if result.rowcount == 0:
        db.rollback()
        fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
        raise AppException(
            status_code=409,
            code="version_conflict",
            message="Work item was modified by another operation",
            details={"current": serialize_item_dict(fresh, current_user, membership.role)},
        )

    # Activity event: status_changed
    event_payload = {"from": old_status, "to": body.to_status}
    if body.reason:
        event_payload["reason"] = body.reason.strip()

    event = ActivityEvent(
        item_id=id,
        actor_id=current_user.id,
        type="status_changed",
        payload=event_payload,
    )
    db.add(event)
    db.flush()

    # Outbox notifications:
    # 1. Entering awaiting_approval -> notify team leads
    if body.to_status == "awaiting_approval":
        leads = (
            db.query(TeamMembership)
            .filter(
                TeamMembership.team_id == item.team_id,
                TeamMembership.role == "lead",
            )
            .all()
        )
        for lead_mem in leads:
            if lead_mem.user_id != current_user.id:
                db.add(Outbox(
                    type="item_awaiting_approval",
                    payload={
                        "event_id": event.id,
                        "item_id": id,
                        "item_key": f"OPS-{id}",
                        "recipient_id": lead_mem.user_id,
                        "actor_id": current_user.id,
                        "message": f"OPS-{id} requires your approval",
                    },
                ))

    # 2. Entering resolved -> notify creator
    if body.to_status == "resolved" and item.created_by != current_user.id:
        db.add(Outbox(
            type="item_resolved",
            payload={
                "event_id": event.id,
                "item_id": id,
                "item_key": f"OPS-{id}",
                "recipient_id": item.created_by,
                "actor_id": current_user.id,
                "message": f"OPS-{id} has been resolved",
            },
        ))

    fresh = db.query(WorkItem).filter(WorkItem.id == id).first()
    response_payload = serialize_item_dict(fresh, current_user, membership.role)

    status_code, final_payload, is_replay = commit_or_replay(
        db, current_user.id, key, req_hash, 200, response_payload
    )
    headers = {"Idempotent-Replay": "true"} if is_replay else {}
    return Response(
        content=json.dumps(final_payload),
        status_code=status_code,
        media_type="application/json",
        headers=headers,
    )


@router.post("/items/{id}/comments")
async def add_comment(
    id: int,
    request: Request,
    body: ItemCommentRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Add a comment to the work item timeline.
    Stored as an append-only ActivityEvent of type comment_added.
    Updates item.last_activity_at.
    """
    key = validate_idempotency_key_header(idempotency_key)
    raw_body = await request.body()
    req_hash = canonical_hash(raw_body)

    replay = check_idempotent_replay(db, current_user.id, key, req_hash)
    if replay:
        status_code, resp_data = replay
        return Response(
            content=json.dumps(resp_data),
            status_code=status_code,
            media_type="application/json",
            headers={"Idempotent-Replay": "true"},
        )

    item = db.query(WorkItem).filter(WorkItem.id == id).first()
    if not item:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    membership = (
        db.query(TeamMembership)
        .filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == item.team_id,
        )
        .first()
    )
    if not membership:
        raise AppException(status_code=404, code="not_found", message="Work item not found")

    if membership.role not in ("member", "lead"):
        raise AppException(
            status_code=403,
            code="forbidden",
            message="Viewers cannot add comments",
        )

    # Insert comment event
    event = ActivityEvent(
        item_id=id,
        actor_id=current_user.id,
        type="comment_added",
        payload={"body": body.body.strip()},
    )
    db.add(event)

    # Touch last_activity_at on the item
    db.execute(
        text("UPDATE work_items SET last_activity_at = NOW() WHERE id = :id"),
        {"id": id},
    )

    db.flush()
    db.refresh(event)
    response_payload = serialize_event_dict(event)

    status_code, final_payload, is_replay = commit_or_replay(
        db, current_user.id, key, req_hash, 200, response_payload
    )
    headers = {"Idempotent-Replay": "true"} if is_replay else {}
    return Response(
        content=json.dumps(final_payload),
        status_code=status_code,
        media_type="application/json",
        headers=headers,
    )


@router.get("/items/{id}/activity", response_model=EventListResponse)
def get_item_activity(
    id: int,
    cursor: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    order: str = Query("desc", pattern="^(desc|asc)$"),
    item_and_role: Tuple[WorkItem, str] = Depends(get_item_and_role),
    db: Session = Depends(get_db),
):
    """
    Get paginated activity timeline and comments for an item.
    Keyset pagination by event ID.
    """
    query = (
        db.query(ActivityEvent)
        .options(joinedload(ActivityEvent.actor))
        .filter(ActivityEvent.item_id == id)
    )

    if order == "desc":
        if cursor is not None:
            query = query.filter(ActivityEvent.id < cursor)
        query = query.order_by(ActivityEvent.id.desc())
    else:
        if cursor is not None:
            query = query.filter(ActivityEvent.id > cursor)
        query = query.order_by(ActivityEvent.id.asc())

    events = query.limit(limit + 1).all()
    has_next = len(events) > limit
    page_events = events[:limit]

    next_cursor = None
    if has_next and page_events:
        next_cursor = str(page_events[-1].id)

    return EventListResponse(
        events=[serialize_event_dict(e) for e in page_events],
        next_cursor=next_cursor,
    )
