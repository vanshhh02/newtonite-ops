import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from sqlalchemy import text, insert
from app.database import SessionLocal
from app.models import (
    User,
    Team,
    TeamMembership,
    WorkItem,
    ActivityEvent,
    PRIORITY_STR_TO_INT,
)
from app.security import get_password_hash

# Pre-computed hash of "password123" to make seeding instant
DEMO_PASSWORD_HASH = get_password_hash("password123")

TEAMS_DATA = [
    {"id": 1, "name": "Core Platform"},
    {"id": 2, "name": "Payments & Risk"},
    {"id": 3, "name": "Compliance & Security"},
    {"id": 4, "name": "Customer Support"},
]

USERS_DATA = [
    # Core Platform users (Maya is also a viewer in Payments & Risk)
    {"id": 1, "email": "lead.core@newtonite.local", "name": "Maya Chen"},
    {"id": 2, "email": "member.core@newtonite.local", "name": "Jordan Patel"},
    {"id": 3, "email": "viewer.core@newtonite.local", "name": "Alex Taylor"},

    # Payments & Risk users
    {"id": 4, "email": "lead.payments@newtonite.local", "name": "Rehan Ahmed"},
    {"id": 5, "email": "member.payments@newtonite.local", "name": "Elena Rostova"},
    {"id": 6, "email": "viewer.payments@newtonite.local", "name": "Sam Becker"},

    # Compliance & Security users
    {"id": 7, "email": "lead.compliance@newtonite.local", "name": "Priya Sharma"},
    {"id": 8, "email": "member.compliance@newtonite.local", "name": "Marcus Brody"},
    {"id": 9, "email": "viewer.compliance@newtonite.local", "name": "Zoe Vance"},

    # Customer Support users
    {"id": 10, "email": "lead.support@newtonite.local", "name": "Daniel Kim"},
    {"id": 11, "email": "member.support@newtonite.local", "name": "Sarah Jenkins"},
    {"id": 12, "email": "viewer.support@newtonite.local", "name": "Leo Morales"},
]

MEMBERSHIPS_DATA = [
    # Core Platform: 1 lead, 2 member, 3 viewer
    {"user_id": 1, "team_id": 1, "role": "lead"},
    {"user_id": 2, "team_id": 1, "role": "member"},
    {"user_id": 3, "team_id": 1, "role": "viewer"},

    # Cross-team role: Maya (lead in Core) is a viewer in Payments & Risk
    {"user_id": 1, "team_id": 2, "role": "viewer"},

    # Payments & Risk: 4 lead, 5 member, 6 viewer
    {"user_id": 4, "team_id": 2, "role": "lead"},
    {"user_id": 5, "team_id": 2, "role": "member"},
    {"user_id": 6, "team_id": 2, "role": "viewer"},

    # Compliance & Security: 7 lead, 8 member, 9 viewer
    {"user_id": 7, "team_id": 3, "role": "lead"},
    {"user_id": 8, "team_id": 3, "role": "member"},
    {"user_id": 9, "team_id": 3, "role": "viewer"},

    # Customer Support: 10 lead, 11 member, 12 viewer
    {"user_id": 10, "team_id": 4, "role": "lead"},
    {"user_id": 11, "team_id": 4, "role": "member"},
    {"user_id": 12, "team_id": 4, "role": "viewer"},
]

SAMPLE_TITLES = {
    "incident": [
        "Payment gateway latency spike exceeding 1500ms",
        "Elevated 500 error rates on authentication service",
        "Redis cluster primary node failover delayed",
        "Kafka consumer lag surging on event processing topic",
        "Database connection pool exhaustion under surge traffic",
        "Webhook delivery retries failing for partner endpoints",
        "Memory leak detected in worker container cluster",
        "Third-party credit check API timing out",
    ],
    "customer_issue": [
        "Customer enterprise tier billing invoice discrepancies",
        "Merchant unable to verify international payout bank details",
        "Duplicate debit card authorization hold on cardholder account",
        "User reported missing balance reconciliation export",
        "Refund status stuck in processing state for 48 hours",
        "Login lockouts triggered by aggressive credential stuffing",
        "Mobile app crash report on biometric verification step",
    ],
    "payment": [
        "Payment approval is overdue for treasury settlement",
        "Cross-border SWIFT transfer requires compliance review",
        "High-value wire release verification over $100k",
        "Suspected fraud alert flagged on automated batch debit",
        "Merchant chargeback threshold breached for account #8491",
        "Reconciliation delta between ledger and payment processor",
    ],
    "compliance": [
        "Update vendor compliance evidence for SOC2 audit",
        "Quarterly GDPR right-to-erasure request backlog review",
        "Anti-Money Laundering transaction threshold review #1042",
        "Sanction screening match alert requires tier-2 verification",
        "Data retention policy enforcement report generation",
        "Customer impact report needs owner for security audit",
    ],
    "task": [
        "Confirm incident closure and update post-mortem timeline",
        "Rotate production database credentials and certificate keys",
        "Audit inactive user roles across all operational teams",
        "Upgrade Postgres minor version on read replica node",
        "Document disaster recovery failover drill procedures",
        "Configure Prometheus alerting thresholds for latency spikes",
    ],
}

COMMENTS_SAMPLE = [
    "Investigating root cause from observability dashboards.",
    "Logs indicate downstream dependency timeout. Contacted provider.",
    "Drafted initial remediation patch, staging deployment underway.",
    "Approval requested from lead. All required documentation attached.",
    "Customer verified the resolution. Ready to proceed with closure.",
    "Holding this until the morning release window.",
    "Escalated priority due to multiple customer impact reports.",
]


def seed_database(scale: str = "small", if_empty: bool = False):
    session = SessionLocal()
    try:
        user_count = session.query(User).count()
        if if_empty and user_count > 0:
            print(f"[seed] Database already contains {user_count} users. Skipping seed (--if-empty).")
            return

        print(f"[seed] Seeding database with scale='{scale}'...")

        # Disable append-only trigger temporarily during full re-seed cleanup if needed
        session.execute(text("TRUNCATE notifications, activity_events, work_items, idempotency_keys, outbox, team_memberships, users, teams RESTART IDENTITY CASCADE;"))
        session.commit()

        # 1. Insert Teams
        for team_dict in TEAMS_DATA:
            session.execute(
                text("INSERT INTO teams (id, name) VALUES (:id, :name)"),
                team_dict,
            )
        session.execute(text("SELECT setval('teams_id_seq', (SELECT MAX(id) FROM teams))"))
        session.commit()

        # 2. Insert Users
        now = datetime.now(timezone.utc)
        for user_dict in USERS_DATA:
            session.execute(
                text("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (:id, :email, :name, :hash, :created_at)"),
                {
                    "id": user_dict["id"],
                    "email": user_dict["email"],
                    "name": user_dict["name"],
                    "hash": DEMO_PASSWORD_HASH,
                    "created_at": now - timedelta(days=60),
                },
            )
        session.execute(text("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))"))
        session.commit()

        # 3. Insert Memberships
        for m in MEMBERSHIPS_DATA:
            session.execute(
                text("INSERT INTO team_memberships (user_id, team_id, role) VALUES (:user_id, :team_id, :role)"),
                m,
            )
        session.commit()

        # 4. Generate Work Items & Events
        target_count = 5000 if scale == "small" else 50000
        print(f"[seed] Generating {target_count} work items...")

        # Team member lookup for valid assignees
        team_members = {1: [1, 2], 2: [4, 5], 3: [7, 8], 4: [10, 11]}
        team_leads = {1: 1, 2: 4, 3: 7, 4: 10}

        batch_size = 1000
        total_items_created = 0
        current_item_id = 0

        # Deterministic pseudo-random seed for reproducible dataset
        rng = random.Random(42)

        types = ["incident", "customer_issue", "payment", "compliance", "task"]
        type_weights = [0.25, 0.25, 0.2, 0.15, 0.15]

        while total_items_created < target_count:
            items_to_create = min(batch_size, target_count - total_items_created)
            work_items_batch = []
            events_batch = []

            for _ in range(items_to_create):
                current_item_id += 1
                item_id = current_item_id
                team_id = rng.choice([1, 2, 3, 4])
                item_type = rng.choices(types, weights=type_weights)[0]

                # Priority: 1-4 (low, medium, high, urgent)
                priority = rng.choices([1, 2, 3, 4], weights=[0.25, 0.45, 0.2, 0.1])[0]

                # Requires approval defaults to true for payment/compliance
                if item_type in ("payment", "compliance"):
                    requires_approval = True
                else:
                    requires_approval = rng.random() < 0.15

                # Status distribution
                # Special cases:
                # - first 50 items reserved for curated operational scenarios (overdue, stale, unassigned urgent, awaiting approval)
                if current_item_id <= 15:
                    # Curated awaiting approval
                    status = "awaiting_approval"
                    requires_approval = True
                    assignee_id = rng.choice(team_members[team_id])
                    created_by = assignee_id
                    is_overdue = current_item_id <= 5
                    is_stale = False
                elif current_item_id <= 30:
                    # Curated unassigned urgent
                    status = "open"
                    priority = 4  # Urgent
                    assignee_id = None
                    created_by = rng.choice(team_members[team_id])
                    is_overdue = False
                    is_stale = False
                elif current_item_id <= 40:
                    # Curated overdue
                    status = "in_progress"
                    assignee_id = rng.choice(team_members[team_id])
                    created_by = assignee_id
                    is_overdue = True
                    is_stale = False
                elif current_item_id <= 50:
                    # Curated stale
                    status = "in_progress"
                    assignee_id = rng.choice(team_members[team_id])
                    created_by = assignee_id
                    is_overdue = False
                    is_stale = True
                else:
                    status = rng.choices(
                        ["open", "in_progress", "awaiting_approval", "resolved", "closed", "cancelled"],
                        weights=[0.35, 0.35, 0.08, 0.12, 0.05, 0.05],
                    )[0]

                    if status == "open":
                        assignee_id = None if rng.random() < 0.7 else rng.choice(team_members[team_id])
                    elif status == "cancelled":
                        assignee_id = None if rng.random() < 0.5 else rng.choice(team_members[team_id])
                    else:
                        assignee_id = rng.choice(team_members[team_id])

                    created_by = rng.choice(team_members[team_id])
                    is_overdue = (status in ["open", "in_progress", "awaiting_approval"]) and (rng.random() < 0.12)
                    is_stale = (status in ["in_progress", "awaiting_approval"]) and (rng.random() < 0.15)

                title_template = rng.choice(SAMPLE_TITLES[item_type])
                title = f"{title_template} (#{item_id})"
                description = (
                    f"Operational report for {title}. Investigated under standard team procedures. "
                    f"Priority level is {priority}. Requires approval: {requires_approval}."
                )

                created_at = now - timedelta(days=rng.randint(3, 45), hours=rng.randint(1, 23))

                if is_overdue:
                    due_at = now - timedelta(hours=rng.randint(2, 48))
                elif rng.random() < 0.6:
                    due_at = now + timedelta(days=rng.randint(1, 14), hours=rng.randint(1, 12))
                else:
                    due_at = None

                if is_stale:
                    last_activity_at = now - timedelta(hours=rng.randint(75, 240))
                else:
                    last_activity_at = now - timedelta(hours=rng.randint(1, 48))

                updated_at = max(created_at, last_activity_at)

                work_items_batch.append({
                    "id": item_id,
                    "team_id": team_id,
                    "title": title,
                    "description": description,
                    "type": item_type,
                    "status": status,
                    "priority": priority,
                    "assignee_id": assignee_id,
                    "created_by": created_by,
                    "requires_approval": requires_approval,
                    "due_at": due_at,
                    "version": 1,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "last_activity_at": last_activity_at,
                })

                # Append-only activity events for item
                # 1. Created event
                events_batch.append({
                    "item_id": item_id,
                    "actor_id": created_by,
                    "type": "created",
                    "payload": {"initial_status": "open"},
                    "created_at": created_at,
                })

                # 2. Assignment / status transition events
                event_time = created_at + timedelta(minutes=10)
                if assignee_id is not None:
                    events_batch.append({
                        "item_id": item_id,
                        "actor_id": assignee_id,
                        "type": "claimed" if assignee_id == created_by else "assigned",
                        "payload": {"assignee_id": assignee_id},
                        "created_at": event_time,
                    })

                if status in ["in_progress", "awaiting_approval", "resolved", "closed", "cancelled"]:
                    event_time += timedelta(minutes=30)
                    events_batch.append({
                        "item_id": item_id,
                        "actor_id": assignee_id or team_leads[team_id],
                        "type": "status_changed",
                        "payload": {"from": "open", "to": status},
                        "created_at": event_time,
                    })

                # 3. Plausible comment
                if rng.random() < 0.4:
                    comment_time = event_time + timedelta(hours=1)
                    events_batch.append({
                        "item_id": item_id,
                        "actor_id": rng.choice(team_members[team_id]),
                        "type": "comment_added",
                        "payload": {"body": rng.choice(COMMENTS_SAMPLE)},
                        "created_at": comment_time,
                    })

            # Bulk insert work items
            session.execute(
                insert(WorkItem),
                work_items_batch,
            )

            # Bulk insert activity events
            session.execute(
                insert(ActivityEvent),
                events_batch,
            )

            session.commit()
            total_items_created += items_to_create
            print(f"[seed] Progress: {total_items_created}/{target_count} items inserted.")

        # Update sequences
        session.execute(text("SELECT setval('work_items_id_seq', (SELECT MAX(id) FROM work_items))"))
        session.execute(text("SELECT setval('activity_events_id_seq', (SELECT MAX(id) FROM activity_events))"))
        session.commit()

        print(f"[seed] Successfully finished seeding {target_count} work items!")

    except Exception as e:
        session.rollback()
        print(f"[seed] ERROR: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed Newtonite Ops database.")
    parser.add_argument(
        "--scale",
        choices=["small", "large"],
        default="small",
        help="Seed scale: small (~5k items) or large (~50k items).",
    )
    parser.add_argument(
        "--if-empty",
        action="store_true",
        help="Only seed if the database contains no users.",
    )
    args = parser.parse_args()
    seed_database(scale=args.scale, if_empty=args.if_empty)
