from sqlalchemy import (
    Column,
    BigInteger,
    Integer,
    SmallInteger,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    UniqueConstraint,
    Index,
    Computed,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import relationship
from app.database import Base

PRIORITY_INT_TO_STR = {
    1: "low",
    2: "medium",
    3: "high",
    4: "urgent",
}

PRIORITY_STR_TO_INT = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "urgent": 4,
}


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    memberships = relationship("TeamMembership", back_populates="user", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    name = Column(String(255), nullable=False)

    memberships = relationship("TeamMembership", back_populates="team", cascade="all, delete-orphan")
    items = relationship("WorkItem", back_populates="team")


class TeamMembership(Base):
    __tablename__ = "team_memberships"

    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String(50), nullable=False)  # viewer | member | lead

    user = relationship("User", back_populates="memberships")
    team = relationship("Team", back_populates="memberships")


class WorkItem(Base):
    __tablename__ = "work_items"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    team_id = Column(BigInteger, ForeignKey("teams.id"), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=False)
    type = Column(String(50), nullable=False)  # incident | customer_issue | payment | compliance | task
    status = Column(String(50), nullable=False, default="open")  # open | in_progress | awaiting_approval | resolved | closed | cancelled
    priority = Column(SmallInteger, nullable=False, default=2)  # 1..4 (low..urgent)
    assignee_id = Column(BigInteger, ForeignKey("users.id"), nullable=True)
    created_by = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    requires_approval = Column(Boolean, nullable=False, default=False)
    due_at = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_activity_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Generated stored tsvector for full-text search
    search_vector = Column(
        TSVECTOR,
        Computed(
            "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    team = relationship("Team", back_populates="items")
    assignee = relationship("User", foreign_keys=[assignee_id])
    creator = relationship("User", foreign_keys=[created_by])
    events = relationship("ActivityEvent", back_populates="item", cascade="all, delete-orphan")

    @property
    def key(self) -> str:
        return f"OPS-{self.id}"

    @property
    def priority_name(self) -> str:
        return PRIORITY_INT_TO_STR.get(self.priority, "medium")

    __table_args__ = (
        # 1. Primary work items query index for team, status, updated_at, id
        Index("idx_work_items_team_status_updated_id", "team_id", "status", updated_at.desc(), id.desc()),
        # 2. Assignee lookup index for 'assigned_to_me' view
        Index("idx_work_items_assignee_status", "assignee_id", "status"),
        # 3. Partial index on active statuses (excluding terminal closed/cancelled)
        Index(
            "idx_work_items_active",
            "team_id",
            "status",
            updated_at.desc(),
            id.desc(),
            postgresql_where=(status.in_(["open", "in_progress", "awaiting_approval"])),
        ),
        # 4. Partial index for unassigned urgent items
        Index(
            "idx_work_items_unassigned_urgent",
            "team_id",
            "priority",
            postgresql_where=((assignee_id.is_(None)) & (status == "open")),
        ),
        # 5. GIN index on generated search_vector
        Index("idx_work_items_search_vector", "search_vector", postgresql_using="gin"),
    )


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    item_id = Column(BigInteger, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    type = Column(String(50), nullable=False)  # created | comment_added | claimed | released | assigned | edited | priority_changed | status_changed
    payload = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    item = relationship("WorkItem", back_populates="events")
    actor = relationship("User")

    __table_args__ = (
        # 6. Index for item timeline and keyset pagination
        Index("idx_activity_events_item_id_id", "item_id", "id"),
    )


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key = Column(String(100), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status_code = Column(Integer, nullable=False)
    response_body = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),
    )


class Outbox(Base):
    __tablename__ = "outbox"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    type = Column(String(100), nullable=False)
    payload = Column(JSONB, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    available_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending | done | dead

    __table_args__ = (
        # 7. Partial index for outbox polling
        Index(
            "idx_outbox_pending",
            "available_at",
            "id",
            postgresql_where=(status == "pending"),
        ),
    )


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(BigInteger, Identity(always=False), primary_key=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(BigInteger, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(BigInteger, ForeignKey("activity_events.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User")
    item = relationship("WorkItem")
    event = relationship("ActivityEvent")

    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_notifications_event_user"),
        Index("idx_notifications_user_read_created", "user_id", "read_at", created_at.desc(), id.desc()),
    )
