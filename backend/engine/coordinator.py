# backend/engine/coordinator.py
"""
PHASE 9 — Execution coordinator.

Full order lifecycle:
  1. Validate intent (symbol, side, quantity)
  2. Check kill switch (Redis → guardian) — BLOCK if active
  3. Verify risk approval (from /market-state output cached in Redis)
  4. Route order through exchange adapters (routing.py)
  5. Process fill → update P&L and balance (pnl.py)
  6. Persist order record (Phase 11 hooks stub)
  7. Publish order_update WebSocket event
  8. Append audit log entry
  9. Notify guardian heartbeat

Rules:
  - No simulated fills in live execution paths (Rule 3)
  - Guardian kill switch always blocks — no bypass (Rule 5)
  - No client-side execution truth (Rule 2)
  - One authoritative P&L path (Rule 6)

Protected files: none accessed here.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from backend.engine.routing import (
    ExecutionFailed,
    ExecutionRejected,
    RoutedOrder,
    route_order,
)
from backend.engine.pnl import process_fill
from backend.services.guardian_bot.service import (
    is_kill_switch_active,
    on_api_error,
    on_failed_order,
    record_heartbeat,
)
from backend.config.loader import get_exchange_config

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Coordinator errors
# ---------------------------------------------------------------------------

class KillSwitchActive(Exception):
    """Execution blocked: kill switch is active."""
    pass


class RiskGateDenied(Exception):
    """Execution blocked: risk gate did not approve this intent."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class IntentValidationError(Exception):
    """Intent body failed validation."""
    pass


# ---------------------------------------------------------------------------
# Intent and result types
# ---------------------------------------------------------------------------

@dataclass
class ExecutionIntent:
    symbol:     str
    side:       str         # "BUY" | "SELL"
    order_type: str         # "MARKET" | "LIMIT"
    quantity:   Decimal
    price:      Optional[Decimal] = None
    mode:       str = "paper"   # "paper" | "live"
    notes:      Optional[str] = None


@dataclass
class ExecutionResult:
    intent:         ExecutionIntent
    order_id:       str
    status:         str         # "FILLED" | "PENDING" | "RISK_REJECTED" | "FAILED"
    fill_price:     Optional[Decimal]
    filled_qty:     Decimal
    venue:          str
    realized_pnl:   Optional[Decimal]   # set for SELL fills
    created_at:     int
    elapsed_ms:     int
    error:          Optional[str] = None


# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

_redis_client = None

async def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import aioredis  # type: ignore
        from backend.config.loader import get_redis_config
        cfg = get_redis_config()
        _redis_client = await aioredis.from_url(cfg.url, decode_responses=True)
        return _redis_client
    except Exception:
        return None


async def _publish_order_update(result: ExecutionResult) -> None:
    """Publish order status to WebSocket broadcaster via Redis pub/sub."""
    r = await _get_redis()
    if r:
        try:
            await r.publish("order_updates", json.dumps({
                "type":       "order_update",
                "id":         result.order_id,
                "symbol":     result.intent.symbol,
                "side":       result.intent.side,
                "quantity":   str(result.intent.quantity),
                "fill_price": str(result.fill_price) if result.fill_price else None,
                "status":     result.status,
                "mode":       result.intent.mode,
                "ts":         result.created_at,
            }))
        except Exception as exc:
            log.warning("Failed to publish order_update: %s", exc)


async def _append_audit_entry(result: ExecutionResult, reason: Optional[str] = None) -> None:
    """Append audit log entry to Redis list (Phase 11 wires to DB)."""
    r = await _get_redis()
    if r:
        try:
            entry = {
                "type":      "order",
                "order_id":  result.order_id,
                "symbol":    result.intent.symbol,
                "side":      result.intent.side,
                "quantity":  str(result.intent.quantity),
                "fill_price": str(result.fill_price) if result.fill_price else None,
                "status":    result.status,
                "mode":      result.intent.mode,
                "ts":        result.created_at,
                "venue":     result.venue,
                "reason":    reason,
            }
            await r.lpush("audit:orders", json.dumps(entry))
            await r.ltrim("audit:orders", 0, 9999)  # keep last 10k entries
        except Exception as exc:
            log.warning("Audit append failed: %s", exc)


async def _check_risk_approval(symbol: str, side: str) -> tuple[bool, str]:
    """
    Check Redis for the most recent risk approval for this symbol.
    Returns (approved, reason).
    Falls back to approved=True when no cached risk state (don't block on cold start).
    """
    r = await _get_redis()
    if not r:
        return True, "risk_cache_unavailable"
    try:
        raw = await r.get(f"risk:latest:{symbol}")
        if not raw:
            return True, "no_cached_risk_state"
        risk = json.loads(raw)
        approved = risk.get("approved", True)
        decision = risk.get("decision", "HOLD")
        if not approved:
            return False, f"Risk engine denied: decision={decision}"
        return True, "approved"
    except Exception:
        return True, "risk_check_error"  # fail open on errors (guardian handles hard blocks)


# ---------------------------------------------------------------------------
# Intent validation
# ---------------------------------------------------------------------------

VALID_SYMBOLS = {
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "XRPUSDT", "DOTUSDT", "AVAXUSDT", "DOGEUSDT", "LINKUSDT",
}
VALID_SIDES = {"BUY", "SELL"}
VALID_TYPES = {"MARKET", "LIMIT"}
MIN_QUANTITY = Decimal("0.00001")
MAX_QUANTITY = Decimal("10000")


def validate_intent(intent: ExecutionIntent) -> None:
    """Raise IntentValidationError if the intent is malformed."""
    if intent.symbol.upper() not in VALID_SYMBOLS:
        raise IntentValidationError(f"Symbol {intent.symbol!r} not in tracked list")
    if intent.side.upper() not in VALID_SIDES:
        raise IntentValidationError(f"Invalid side {intent.side!r}")
    if intent.order_type.upper() not in VALID_TYPES:
        raise IntentValidationError(f"Invalid order_type {intent.order_type!r}")
    if not (MIN_QUANTITY <= intent.quantity <= MAX_QUANTITY):
        raise IntentValidationError(
            f"Quantity {intent.quantity} out of range [{MIN_QUANTITY}, {MAX_QUANTITY}]"
        )
    if intent.order_type.upper() == "LIMIT" and intent.price is None:
        raise IntentValidationError("LIMIT orders require a price")


# ---------------------------------------------------------------------------
# Main coordinator entry point
# ---------------------------------------------------------------------------

async def execute_intent(intent: ExecutionIntent) -> ExecutionResult:
    """
    Execute a trading intent end-to-end.

    Steps:
      1. Validate
      2. Kill switch check (blocks if active)
      3. Risk gate check (blocks if not approved)
      4. Route to exchange adapter
      5. Process fill → P&L update
      6. Persist (stub until Phase 11)
      7. Publish WebSocket order_update
      8. Append audit log
      9. Guardian heartbeat

    Returns ExecutionResult with full fill details.
    Raises on validation, kill switch, or routing failure.
    """
    now = int(time.time())
    t0_ms = int(time.time() * 1000)

    # --- 1. Validate ---
    try:
        validate_intent(intent)
    except IntentValidationError as exc:
        raise

    # --- 2. Kill switch check (Rule 5: risk overrides strategy) ---
    if await is_kill_switch_active():
        log.warning("Intent BLOCKED: kill switch active for %s %s", intent.side, intent.symbol)
        result = ExecutionResult(
            intent=intent, order_id="", status="RISK_REJECTED",
            fill_price=None, filled_qty=Decimal("0"),
            venue="blocked", realized_pnl=None, created_at=now,
            elapsed_ms=0, error="Kill switch active",
        )
        await _append_audit_entry(result, reason="kill_switch_active")
        raise KillSwitchActive("Kill switch is active — trading halted")

    # --- 3. Risk gate ---
    approved, risk_reason = await _check_risk_approval(intent.symbol, intent.side)
    if not approved:
        log.warning("Intent BLOCKED by risk gate: %s %s — %s", intent.side, intent.symbol, risk_reason)
        result = ExecutionResult(
            intent=intent, order_id="", status="RISK_REJECTED",
            fill_price=None, filled_qty=Decimal("0"),
            venue="risk_gate", realized_pnl=None, created_at=now,
            elapsed_ms=0, error=risk_reason,
        )
        await _append_audit_entry(result, reason=risk_reason)
        await _publish_order_update(result)
        raise RiskGateDenied(risk_reason)

    # --- 4. Route order ---
    try:
        routed = await route_order(
            symbol=intent.symbol.upper(),
            side=intent.side.upper(),
            order_type=intent.order_type.upper(),
            quantity=intent.quantity,
            price=intent.price,
        )
        order = routed.order

    except ExecutionRejected as exc:
        # Exchange hard-rejected — count as failed order for guardian
        await on_failed_order()
        result = ExecutionResult(
            intent=intent, order_id="", status="FAILED",
            fill_price=None, filled_qty=Decimal("0"),
            venue="exchange", realized_pnl=None, created_at=now,
            elapsed_ms=int(time.time() * 1000) - t0_ms,
            error=str(exc.reason),
        )
        await _publish_order_update(result)
        await _append_audit_entry(result, reason=str(exc.reason))
        raise

    except ExecutionFailed as exc:
        # All adapters failed — count as API error for guardian
        await on_api_error()
        result = ExecutionResult(
            intent=intent, order_id="", status="FAILED",
            fill_price=None, filled_qty=Decimal("0"),
            venue="none", realized_pnl=None, created_at=now,
            elapsed_ms=int(time.time() * 1000) - t0_ms,
            error=exc.reason,
        )
        await _publish_order_update(result)
        await _append_audit_entry(result, reason=exc.reason)
        raise

    # --- 5. Process fill → P&L ---
    realized_trade = None
    if order.fill_price and order.filled_qty > 0:
        realized_trade = process_fill(
            order_id=order.id,
            symbol=intent.symbol,
            side=intent.side.upper(),
            quantity=order.filled_qty,
            fill_price=order.fill_price,
            filled_at=now,
        )

    elapsed = int(time.time() * 1000) - t0_ms

    result = ExecutionResult(
        intent=intent,
        order_id=order.id,
        status=order.status,
        fill_price=order.fill_price,
        filled_qty=order.filled_qty,
        venue=routed.venue,
        realized_pnl=realized_trade.realized_pnl if realized_trade else None,
        created_at=now,
        elapsed_ms=elapsed,
    )

    # --- 6. Phase 11 persistence hook (stub) ---
    # await db_repo.save_order(result)

    # --- 7. WebSocket publication ---
    await _publish_order_update(result)

    # --- 8. Audit log ---
    await _append_audit_entry(result)

    # --- 9. Guardian heartbeat ---
    record_heartbeat()

    log.info(
        "Intent executed: %s %s %s @ %s — status=%s elapsed=%dms",
        intent.mode.upper(), intent.side, intent.symbol,
        result.fill_price, result.status, elapsed,
    )

    return result
