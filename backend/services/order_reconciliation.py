"""Deterministic exchange-order reconciliation for sandbox/live adapters.

The service is intentionally pure: it never submits, cancels, or retries an order.
It only converts exchange observations into a fail-closed decision.
"""

from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Optional

_ACTIVE_RAW = {
    "new",
    "open",
    "pending",
    "submitted",
    "partially_filled",
    "partiallyfilled",
    "partial",
}
_CANCELLED_RAW = {"cancelled", "canceled"}
_FAILED_RAW = {"rejected", "expired", "failed"}
_FILLED_RAW = {"closed", "filled"}


@dataclass(frozen=True)
class ReconciliationDecision:
    exchange_order_id: Optional[str]
    status: str
    action: str
    requested_quantity: float
    filled_quantity: float
    remaining_quantity: float
    average_price: Optional[float]
    terminal: bool
    requires_review: bool
    raw_status: str
    reason: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _number(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _optional_number(value: Any) -> Optional[float]:
    parsed = _number(value, default=math.nan)
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def _recovery(
    *,
    exchange_order_id: Optional[str],
    raw_status: str,
    requested: float,
    filled: float,
    remaining: float,
    average_price: Optional[float],
    reason: str,
) -> ReconciliationDecision:
    return ReconciliationDecision(
        exchange_order_id=exchange_order_id,
        status="RECOVERY_REQUIRED",
        action="HMALT_FOR_REVIEW",
        requested_quantity=requested,
        filled_quantity=filled,
        remaining_quantity=remaining,
        average_price=average_price,
        terminal=False,
        requires_review=True,
        raw_status=raw_status,
        reason=reason,
    )


def reconcile_order_observation(
    order: Mapping[str, Any],
    *,
    requested_quantity: Optional[float] = None,
    observed_at: Optional[float] = None,
    now: Optional[float] = None,
    stale_after_seconds: int = 300,
) -> ReconciliationDecision:
    """Normalize one exchange order observation without taking an exchange action.

    Unknown or internally inconsistent observations become `RECOVERY_REQUIRED@.
    That state must be reconciled by order ID; it must never trigger a new order.
    """

    exchange_order_id_raw = order.get("id") or order.get("order_id")
    exchange_order_id = (
        str(exchange_order_id_raw).strip() if exchange_order_id_raw else None
    )
    raw_status = str(order.get("status") or order.get("raw_status") or "").strip().lower()

    requested = _number(
        requested_quantity if requested_quantity is not None else order.get("amount"),
        default=0.0,
    )
    filled = _number(order.get("filled"), default=0.0)
    remaining_value = order.get("remaining")
    remaining = (
        _number(remaining_value, default=max(requested - filled, 0.0))
        if remaining_value is not None
        else max(requested - filled, 0.0)
    )
    average_price = _optional_number(order.get("average") or order.get("fill_price") or order.get("price"))

    if not exchange_order_id:
        return _recovery(
            exchange_order_id=None,
            raw_status=raw_status,
            requested=requested,
            filled=filled,
            remaining=remaining,
            average_price=average_price,
            reason="exchange_order_id_missing",
        )
    if requested <= 0:
        return _recovery(
            exchange_order_id=exchange_order_id,
            raw_status=raw_status,
            requested=requested,
            filled=filled,
            remaining=remaining,
            average_price=average_price,
            reason="requested_quantity_invalid",
        )
    if filled < 0 or remaining < 0:
        return _recovery(
            exchange_order_id=exchange_order_id,
            raw_status=raw_status,
            requested=requested,
            filled=filled,
            remaining=remaining,
            average_price=average_price,
            reason="negative_exchange_quantity",
        )

    tolerance = max(requested * 1e-9, 1e-12)
    if filled > requested + tolerance:
        return _recovery(
            exchange_order_id=exchange_order_id,
            raw_status=raw_status,
            requested=requested,
            filled=filled,
            remaining=remaining,
            average_price=average_price,
            reason="filled_quantity_exceeds_requested",
        )

    if filled >= requested - tolerance:
        return ReconciliationDecision(
            exchange_order_id=exchange_order_id,
            status="FILLED",
            action="FINALIZE",
            requested_quantity=requested,
            filled_quantity=min(filled, requested),
            remaining_quantity=0.0,
            average_price=average_price,
            terminal=True,
            requires_review=False,
            raw_status=raw_status,
        )

    if 0 < filled < requested:
        terminal_partial = raw_status in (_CANCELLED_RAW | _FAILED_RAW | _FILLED_RAW)
        return ReconciliationDecision(
            exchange_order_id=exchange_order_id,
            status="PARTIALLY_FILLED",
            action="FINALIZE_PARTIAL" if terminal_partial else "WAIT",
            requested_quantity=requested,
            filled_quantity=filled,
            remaining_quantity=max(requested - filled, 0.0),
            average_price=average_price,
            terminal=terminal_partial,
            requires_review=False,
            raw_status=raw_status,
            reason="terminal_partial_fill" if terminal_partial else None,
        )

    if raw_status in _CANCELLED_RAW:
        return ReconciliationDecision(
            exchange_order_id=exchange_order_id,
            status="CANCELLED",
            action="FINALIZE",
            requested_quantity=requested,
            filled_quantity=0.0,
            remaining_quantity=requested,
            average_price=average_price,
            terminal=True,
            requires_review=False,
            raw_status=raw_status,
        )

    if raw_status in _FAILED_RAW:
        return ReconciliationDecision(
            exchange_order_id=exchange_order_id,
            status="FAILED",
            action="FINALIZE",
            requested_quantity=requested,
            filled_quantity=0.0,
            remaining_quantity=requested,
            average_price=average_price,
            terminal=True,
            requires_review=False,
            raw_status=raw_status,
        )

    if raw_status in _FILLED_RAW:
        return _recovery(
            exchange_order_id=exchange_order_id,
            raw_status=raw_status,
            requested=requested,
            filled=filled,
            remaining=remaining,
            average_price=average_price,
            reason="terminal_status_without_fill",
        )

    if raw_status in _ACTIVE_RAW:
        current = time.time() if now is None else float(now)
        observed = current if observed_at is None else float(observed_at)
        age = max(0.0, current - observed)
        if stale_after_seconds > 0 and age >= stale_after_seconds:
            return _recovery(
                exchange_order_id=exchange_order_id,
                raw_status=raw_status,
                requested=requested,
                filled=filled,
                remaining=remaining,
                average_price=average_price,
                reason="stale_exchange_order",
            )
        return ReconciliationDecision(
            exchange_order_id=exchange_order_id,
            status="SUBMITTED",
            action="WAIT",
            requested_quantity=requested,
            filled_quantity=0.0,
            remaining_quantity=requested,
            average_price=average_price,
            terminal=False,
            requires_review=False,
            raw_status=raw_status,
       )

    return _recovery(
        exchange_order_id=exchange_order_id,
        raw_status=raw_status,
        requested=requested,
        filled=filled,
        remaining=remaining,
        average_price=average_price,
        reason="unsupported_exchange_status",
    )
