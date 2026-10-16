"""
Idempotency subsystem.

Guarantees exactly-once mutation semantics for mutating POST requests:
1. Validates presence of UUID Idempotency-Key header.
2. Canonicalizes and hashes request payload.
3. Checks for previous execution in idempotency_keys.
4. Serializes concurrent identical requests on the database unique index.
5. Commits the idempotency record in the SAME transaction as the business mutation.
"""

import hashlib
import json
import uuid
from typing import Any, Optional, Tuple
from fastapi import Header, Request, Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.models import IdempotencyKey
from app.exceptions import AppException


def canonical_hash(body: Any) -> str:
    """Produce deterministic SHA-256 hash of request body."""
    if body is None:
        raw = b""
    elif isinstance(body, bytes):
        raw = body
    elif isinstance(body, str):
        raw = body.encode("utf-8")
    else:
        raw = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def validate_idempotency_key_header(key: Optional[str]) -> str:
    """Validate that Idempotency-Key header is present and is a valid UUID."""
    if not key or not key.strip():
        raise AppException(
            status_code=422,
            code="validation_error",
            message="Missing required Idempotency-Key header",
            details={"fields": [{"field": "header.Idempotency-Key", "message": "Field required"}]},
        )
    key_str = key.strip()
    try:
        uuid.UUID(key_str)
    except ValueError:
        raise AppException(
            status_code=422,
            code="validation_error",
            message="Idempotency-Key must be a valid UUID",
            details={"fields": [{"field": "header.Idempotency-Key", "message": "Invalid UUID format"}]},
        )
    return key_str


def check_idempotent_replay(
    db: Session,
    user_id: int,
    key: str,
    request_hash: str,
) -> Optional[Tuple[int, dict[str, Any]]]:
    """
    Check if this idempotency key was previously processed.
    Returns (status_code, response_body) if match found.
    Raises 422 if key was reused with a different request body.
    """
    existing = (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.key == key,
        )
        .first()
    )

    if existing:
        if existing.request_hash != request_hash:
            raise AppException(
                status_code=422,
                code="idempotency_key_reused",
                message="Idempotency key was previously used with a different request payload",
            )
        return existing.status_code, existing.response_body

    return None


def record_idempotent_response(
    db: Session,
    user_id: int,
    key: str,
    request_hash: str,
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    """Record successful 2xx response in the same transaction."""
    record = IdempotencyKey(
        user_id=user_id,
        key=key,
        request_hash=request_hash,
        status_code=status_code,
        response_body=response_body,
    )
    db.add(record)


def commit_or_replay(
    db: Session,
    user_id: int,
    key: str,
    request_hash: str,
    status_code: int,
    response_payload: dict[str, Any],
) -> Tuple[int, dict[str, Any], bool]:
    """
    Commit transaction containing the recorded response.
    If another concurrent transaction commits the exact same key first,
    catch the UniqueViolation on uq_idempotency_user_key, roll back this duplicate transaction,
    and read the winner's committed response to replay it.
    
    Returns: (status_code, response_payload, is_replay)
    """
    try:
        db.commit()
        return status_code, response_payload, False
    except IntegrityError as exc:
        db.rollback()
        # Verify if the integrity error was on the idempotency key unique constraint
        replay = check_idempotent_replay(db, user_id, key, request_hash)
        if replay:
            replay_status, replay_body = replay
            return replay_status, replay_body, True
        raise exc
