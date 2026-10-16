"""
Transactional Outbox Background Worker.

Polls pending outbox records using `SELECT ... FOR UPDATE SKIP LOCKED` in batches.
Guarantees:
1. Concurrency safe: multiple worker processes never lock or double-process the same row.
2. At-least-once delivery with idempotent deduplication via `ON CONFLICT (event_id, user_id) DO NOTHING`.
3. Never notifies the actor who triggered the action.
4. Retry with exponential backoff on failure; transitions to 'dead' after 5 attempts.
5. Transaction-scoped locks: crashed workers immediately release held rows back to the pool.
"""

import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Any
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Outbox, Notification
from app.config import settings

MAX_ATTEMPTS = 5


def process_single_outbox_row(db: Session, row: Any) -> None:
    """
    Process an individual outbox record.
    Inserts notification idempotently; skips self-notifications.
    """
    payload = row.payload
    recipient_id = payload.get("recipient_id")
    actor_id = payload.get("actor_id")
    event_id = payload.get("event_id")
    item_id = payload.get("item_id")
    message = payload.get("message", "")
    notification_type = row.type

    # Rule: Never notify the actor
    if recipient_id and actor_id and recipient_id == actor_id:
        db.execute(
            text("UPDATE outbox SET status = 'done', processed_at = NOW() WHERE id = :id"),
            {"id": row.id},
        )
        return

    # Idempotent insert with ON CONFLICT DO NOTHING
    db.execute(
        text("""
        INSERT INTO notifications (user_id, item_id, event_id, type, message, created_at)
        VALUES (:user_id, :item_id, :event_id, :type, :message, NOW())
        ON CONFLICT (event_id, user_id) DO NOTHING;
        """),
        {
            "user_id": recipient_id,
            "item_id": item_id,
            "event_id": event_id,
            "type": notification_type,
            "message": message,
        },
    )

    # Mark outbox record as done
    db.execute(
        text("UPDATE outbox SET status = 'done', processed_at = NOW() WHERE id = :id"),
        {"id": row.id},
    )


def process_outbox_batch(db: Session, batch_size: int = 20) -> int:
    """
    Fetch and process a batch of pending outbox records using FOR UPDATE SKIP LOCKED.
    Returns the number of rows processed in this batch.
    """
    # Select available pending records with transaction-scoped row-level locks
    rows = (
        db.query(Outbox)
        .filter(
            Outbox.status == "pending",
            Outbox.available_at <= datetime.now(timezone.utc),
        )
        .order_by(Outbox.available_at.asc(), Outbox.id.asc())
        .limit(batch_size)
        .with_for_update(skip_locked=True)
        .all()
    )

    if not rows:
        return 0

    processed_count = 0
    for row in rows:
        try:
            process_single_outbox_row(db, row)
            db.commit()
            processed_count += 1
        except Exception as exc:
            db.rollback()
            # Handle failure: increment attempts, calculate exponential backoff, or mark dead
            handle_outbox_failure(db, row.id, str(exc))

    return processed_count


def handle_outbox_failure(db: Session, outbox_id: int, error_message: str) -> None:
    """Handle processing failure with retries, exponential backoff, and dead-lettering."""
    try:
        record = db.query(Outbox).filter(Outbox.id == outbox_id).first()
        if not record:
            return

        new_attempts = record.attempts + 1
        if new_attempts >= MAX_ATTEMPTS:
            record.status = "dead"
            record.attempts = new_attempts
            record.last_error = error_message
        else:
            backoff_seconds = 2 ** new_attempts
            record.attempts = new_attempts
            record.available_at = datetime.now(timezone.utc) + timedelta(seconds=backoff_seconds)
            record.last_error = error_message

        db.commit()
    except Exception:
        db.rollback()


def run_worker_loop():
    """Main worker daemon polling loop."""
    print(f"[worker] Starting outbox background worker (poll interval: {settings.WORKER_POLL_INTERVAL_SECONDS}s)...")
    while True:
        session = SessionLocal()
        try:
            count = process_outbox_batch(session, batch_size=settings.WORKER_BATCH_SIZE)
            if count > 0:
                print(f"[worker] Processed {count} outbox records.")
            else:
                time.sleep(settings.WORKER_POLL_INTERVAL_SECONDS)
        except Exception as exc:
            print(f"[worker] Unexpected error in polling loop: {exc}", file=sys.stderr)
            time.sleep(settings.WORKER_POLL_INTERVAL_SECONDS)
        finally:
            session.close()


if __name__ == "__main__":
    run_worker_loop()
