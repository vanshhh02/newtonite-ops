from datetime import datetime
from typing import Any, List, Optional, Literal
from pydantic import BaseModel, Field, EmailStr

# Contract Enums
ItemType = Literal["incident", "customer_issue", "payment", "compliance", "task"]
ItemStatus = Literal["open", "in_progress", "awaiting_approval", "resolved", "closed", "cancelled"]
ItemPriority = Literal["low", "medium", "high", "urgent"]
TeamRole = Literal["viewer", "member", "lead"]


# Standard Error Envelope: {"error": {"code": "...", "message": "...", "details": ...}}
class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[Any] = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# Auth Schemas
class LoginRequest(BaseModel):
    email: str
    password: str


class UserBrief(BaseModel):
    id: int
    name: str
    email: str


class UserRef(BaseModel):
    id: int
    name: str


class LoginResponse(BaseModel):
    access_token: str
    user: UserBrief


class TeamMembershipOut(BaseModel):
    team_id: int
    team_name: str
    role: TeamRole


class MeResponse(BaseModel):
    user: UserBrief
    memberships: List[TeamMembershipOut]


class TeamMemberOut(BaseModel):
    user_id: int
    name: str
    role: TeamRole


# Work Item Schemas
class ItemCreateRequest(BaseModel):
    team_id: int
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(..., min_length=1)
    type: ItemType
    priority: ItemPriority
    requires_approval: Optional[bool] = None
    due_at: Optional[datetime] = None


class ItemPatchRequest(BaseModel):
    expected_version: int
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = Field(None, min_length=1)
    priority: Optional[ItemPriority] = None
    due_at: Optional[datetime] = None


class ItemClaimRequest(BaseModel):
    pass


class ItemReleaseRequest(BaseModel):
    expected_version: int


class ItemAssignRequest(BaseModel):
    assignee_id: Optional[int] = None
    expected_version: int


class ItemTransitionRequest(BaseModel):
    to_status: ItemStatus
    expected_version: int
    reason: Optional[str] = None


class ItemCommentRequest(BaseModel):
    body: str = Field(..., min_length=1)


class ItemSummary(BaseModel):
    id: int
    key: str
    team_id: int
    team_name: str
    title: str
    type: ItemType
    status: ItemStatus
    priority: ItemPriority
    assignee: Optional[UserRef] = None
    created_by: UserRef
    requires_approval: bool
    due_at: Optional[datetime] = None
    version: int
    created_at: datetime
    updated_at: datetime
    last_activity_at: datetime


class Item(ItemSummary):
    description: str
    allowed_actions: List[str]


class ItemListResponse(BaseModel):
    items: List[ItemSummary]
    next_cursor: Optional[str] = None


# Activity Event Schemas
class EventOut(BaseModel):
    id: int
    item_id: int
    type: str
    actor: UserRef
    payload: dict[str, Any]
    created_at: datetime


class EventListResponse(BaseModel):
    events: List[EventOut]
    next_cursor: Optional[str] = None


# Dashboard Schemas
class DashboardCounts(BaseModel):
    assigned_to_me: int
    unassigned_urgent: int
    awaiting_my_approval: int
    overdue: int
    stale: int


class DashboardSummaryResponse(BaseModel):
    counts: DashboardCounts


# Notification Schemas
class NotificationOut(BaseModel):
    id: int
    item_id: int
    item_key: str
    type: str
    message: str
    read_at: Optional[datetime] = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: List[NotificationOut]
    next_cursor: Optional[str] = None


class UnreadCountResponse(BaseModel):
    count: int
