"""Crash-safe idempotency and recovery state for exchange execution requests."""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.db.models.execution_request import ExecutionRequestRecord
from backend.db.session import get_session

_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_TERMINAL_STATUSES = {
    "COMPLETED",
    "COMPLETED_PARTIAL",
    "CANCELLED",
    "FAILED",
    "REJECTED",
}
_ACTIVE_STATUSES = {
    "CLAIMED",
    "SUBMITTING",
    "SUBMITTED",
    "PARTIALLY_FILLED",
}
_DEFAULT_STALE_SECONDS = 300


class InvalidIdempotencyKey(ValueError):
    """The caller supplied an invalid idempotency key."""


@dataclass(frozen=True)
class ClaimResult:
    state: str
    operation_id: str
    status: str
    response: Optional[dict[str, Any]] = None
    age_seconds: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "operation_id": self.operation_id,
            "status": self.status,
            "response": self.response,
            "age_seconds": self.age_seconds,
        }


def validate_idempotency_key(value: str) -> str:
    normalized = (value or "").strip()
    if not _KEY_PATTERN.fullmatch(normalized):
        raise InvalidIdempotencyKey(
            "Idempotency-Key must be 8-128 characters using letters, "
            "numbers, dot, underscore, colon, or hyphen."
        )
    return normalized


def request_fingerprint(payload: Mapping[str, Any], mode: str) -> str:
    envelope = {"mode": mode.strip().lower(), "payload": dict(payload)}
    encoded = json.dumps(
        envelope,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def ledger_status_for_response(response: Mapping[str, Any]) -> str:
    """Convert an intent response into a durable execution-ledger state."""

    status = str(response.get("status") or "").strip().upper()
    return {
        "FILLED": "COMPLETED",
        "PARTIALLY_FILLED": "PARTIALLY_FILLED",
        "SUBMITTED": "SUBMITTED",
        "PENDING": "SUBMITTED",
        "RISK_APPROVED": "SUBMITTED",
        "CANCELLED": "CANCELLED",
        "CANCELED": "CANCELLED",
        "RISK_REJECTED": "REJECTED",
        "REJECTED": "REJECTED",
        "FAILED": "FAILED",
        "RECOVERY_REQUIRED": "RECOVERY_REQUIRED",
    }.get(status, "RECOVERY_REQUIRED")


def ledger_status_for_reconciliation(decision: Mapping[str, Any]) -> str:
    """Convert a reconciliation decision into a durable ledger state."""

    status = str(decision.get("status") or "").strip().upper()
    terminal = bool(decision.get("terminal"))
    if status == "FILLED":
        return "COMPLETED"
    if status == "PARTIALLY_FILLED":
        return "COMPLETED_PARTIAL" if terminal else "PARTIALLY_FILLED"
    if status == "SUBMITTED":
        return "SUBMITTED"
    if status in {"CANCELLED", "CANCELED"}:
        return "CANCELLED"
    if status in {"FAILED", "REJECTED"}:
        return "FAILED"
    return "RECOVERY_REQUIRED"


def _decode_response(raw: Optional[str]) -> Optional[dict[str, Any]]:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def classify_existing(
    *,
    request_hash: str,
    existing_hash: str,
    operation_id: str,
    status: str,
    response_json: Optional[str],
    updated_at: Optional[int],
    now: Optional[int] = None,
    stale_seconds: int = _DEFAULT_STALE_SECONDS,
) -> ClaimResult:
    current = int(time.time()) if now is None else int(now)
    age = max(0, current - int(updated_at or current))

    if request_hash != existing_hash:
        return ClaimResult(
            state="CONFLICT",
            operation_id=operation_id,
            status=status,
            age_seconds=age,
        )
    if status in _TERMINAL_STATUSES:
        return ClaimResult(
            state="REPLAY",
            operation_id=operation_id,
            status=status,
            response=_decode_response(response_json),
            age_seconds=age,
        )
    if status == "RECOVERY_REQUIRED":
        return ClaimResult(
            state="RECOVERY_REQUIRED",
            operation_id=operation_id,
            status=status,
            age_seconds=age,
        )
    if status in _ACTIVE_STATUSES and age >= stale_seconds:
        return ClaimResult(
            state="RECOVERY_REQUIRED",
            operation_id=operation_id,
            status=status,
            age_seconds=age,
        )
    return ClaimResult(
        state="IN_PROGRESS",
        operation_id=operation_id,
        status=status,
        age_seconds=age,
    )


async def claim_execution(
    *,
    idempotency_key: str,
    payload: Mapping[str, Any],
    mode: str,
    stale_seconds: int = _DEFAULT_STALE_SECONDS,
) -> ClaimResult:
    key = validate_idempotency_key(idempotency_key)
    fingerprint = request_fingerprint(payload, mode)
    operation_id = str(uuid.uuid4())
    now = int(time.time())

    async with get_session() as session:
        record = ExecutionRequestRecord(
            idempotency_key=key,
            request_hash=fingerprint,
            operation_id=operation_id,
            mode=mode.strip().lower(),
            status="CLAIMED",
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        try:
            await session.commit()
            return ClaimResult(
                state="CLAIMED",
                operation_id=operation_id,
                status="CLAIMED",
            )
        except IntegrityError:
            await session.rollback()

        result = await session.execute(
            select(ExecutionRequestRecord).where(
                ExecutionRequestRecord.idempotency_key == key
            )
        )
        existing = result.scalar_one()
        classification = classify_existing(
            request_hash=fingerprint,
            existing_hash=existing.request_hash,
            operation_id=existing.operation_id,
            status=existing.status,
            response_json=existing.response_json,
            updated_at=existing.updated_at,
            stale_seconds=stale_seconds,
        )
        if (
            classification.state == "RECOVERY_REQUIRED"
            and existing.status in _ACTIVE_STATUSES
        ):
            existing.status = "RECOVERY_REQUIRED"
            existing.error_code = "stale_execution_claim"
            existing.updated_at = int(time.time())
            await session.commit()
            classification = ClaimResult(
                state="RECOVERY_REQUIRED",
                operation_id=existing.operation_id,
                status="RECOVERY_REQUIRED",
                age_seconds=classification.age_seconds,
            )
        return classification


async def mark_submitting(idempotency_key: str, operation_id: str) -> bool:
    key = validate_idempotency_key(idempotency_key)
    async with get_session() as session:
        result = await session.execute(
            update(ExecutionRequestRecord)
            .where(
                ExecutionRequestRecord.idempotency_key == key,
                ExecutionRequestRecord.operation_id == operation_id,
                ExecutionRequestRecord.status == "CLAIMED",
            )
            .values(status="SUBMITTING", updated_at=int(time.time()))
        )
        await session.commit()
        return bool(result.rowcount)


async def complete_execution(
    *,
    idempotency_key: str,
    operation_id: str,
    intent_id: str,
    response: Mapping[str, Any],
    exchange_order_id: Optional[str] = None,
) -> bool:
    """Persist the handler result without pretending active orders are terminal."""

    key = validate_idempotency_key(idempotency_key)
    response_payload = dict(response)
    serialized = json.dumps(response_payload, sort_keys=True, default=str)
    ledger_status = ledger_status_for_response(response_payload)
    error_code = (
        "unsupported_execution_response"
        if ledger_status == "RECOVERY_REQUIRED"
        else None
    )
    async with get_session() as session:
        result = await session.execute(
            update(ExecutionRequestRecord)
            .where(
                ExecutionRequestRecord.idempotency_key == key,
                ExecutionRequestRecord.operation_id == operation_id,
                ExecutionRequestRecord.status == "SUBMITTING",
            )
            .values(
                status=ledger_status,
                intent_id=intent_id,
                exchange_order_id=exchange_order_id,
                response_json=serialized,
                error_code=error_code,
                updated_at=int(time.time()),
            )
        )
        await session.commit()
        return bool(result.rowcount)


async def apply_reconciliation(
    *,
   idempotency_key: str,
    operation_id: str,
    decision: Mapping[str, Any],
) -> bool:
    """Apply a read-only exchange observation to an active execution record."""

    key = validate_idempotency_key(idempotency_key)
    decision_payload = dict(decision)
    ledger_status = ledger_status_for_reconciliation(decision_payload)
    exchange_order_id_raw = decision_payload.get("exchange_order_id")
    exchange_order_id = (
        str(exchange_order_id_raw).strip() if exchange_order_id_raw else None
    )
    reason = str(decision_payload.get("reason") or "").strip() or None

    async with get_session() as session:
        result = await session.execute(
            select(ExecutionRequestRecord)
            .where(
                ExecutionRequestRecord.idempotency_key == key,
                ExecutionRequestRecord.operation_id == operation_id,
            )
            .with_for_update()
        )
        record = result.scalar_one_or_none()
        if record is None or record.status not in _ACTIVE_STATUSES:
            return False

        replay_response = _decode_response(record.response_json) or {}
        if record.intent_id and not replay_response.get("id"):
            replay_response["id"] = record.intent_id
        replay_response["status"] = str(
            decision_payload.get("status") or "RECOVERY_REQUIRED"
        ).upper()
        replay_response["notes"] = reason
        record.status = ledger_status
        record.exchange_order_id = exchange_order_id or record.exchange_order_id
        record.response_json = json.dumps(
            replay_response,
            sort_keys=True,
            default=str,
        )
        record.error_code = (
            (reason or "reconciliation_required")[:64]
            if ledger_status == "RECOVERY_REQUIRED"
            else None
        )
        record.updated_at = int(time.time())
        await session.commit()
        return True


async def mark_recovery_required(
    *,
    idempotency_key: str,
    operation_id: str,
    error_code: str,
) -> bool:
    key = validate_idempotency_key(idempotency_key)
    async with get_session() as session:
        result = await session.execute(
            update(ExecutionRequestRecord)
            .where(
                ExecutionRequestRecord.idempotency_key == key,
                ExecutionRequestRecord.operation_id == operation_id,
                ExecutionRequestRecord.status.in_(tuple(_ACTIVE_STATUSES)),
            )
            .values(
                status="RECOVERY_REQUIRED",
                error_code=(error_code or "execution_uncertain")[:64],
                updated_at=int(time.time()),
            )
        )
        await session.commit()
        return bool(result.rowcount)


async def get_execution_status(
    idempotency_key: str,
) -> Optional[dict[str, Any]]:
    key = validate_idempotency_key(idempotency_key)
    async with get_session() as session:
        result = await session.execute(
            select(ExecutionRequestRecord).where(
                ExecutionRequestRecord.idempotency_key == key
            )
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        return {
            "idempotency_key": record.idempotency_key,
            "operation_id": record.operation_id,
            "mode": record.mode,
            "status": record.status,
            "intent_id": record.intent_id,
            "exchange_order_id": record.exchange_order_id,
            "error_code": record.error_code,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "response_available": bool(record.response_json),
        }
