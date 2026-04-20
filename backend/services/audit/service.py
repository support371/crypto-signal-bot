# backend/services/audit/service.py
"""
PHASE 10 — Audit service.

Append-only audit log for all system events that affect runtime state:
  - Manual kill-switch activation/deactivation
  - Guardian auto-activation
  - Order submissions (filled, rejected, blocked)
  - Risk gate denials
  - Withdrawals

Rules:
  - Every entry is immutable once written
  - All kill-switch events (manual and auto) must be audited
  - Audit reads are available for the frontend /audit endpoint
  - Phase 11 wires this to the DB; this module uses Redis list as staging

Protected files: none accessed here.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Audit event types
# ---------------------------------------------------------------------------

class AuditEventType(str, Enum):
    KILL_SWITCH_MANUAL     = "kill_switch_manual"
    KILL_SWITCH_GUARDIAN   = "kill_switch_guardian"
    KILL_SWITCH_DEACTIVATE = "kill_switch_deactivate"
    ORDER_FILLED           = "order_filled"
    ORDER_FAILED           = "order_failed"
    ORDER_REJECTED         = "order_rejected"
    RISK_GATE_DENIED       = "risk_gate_denied"
    WITHDRAWAL             = "withdrawal"
    EARNINGS_RESET         = "earnings_reset"
    SYSTEM_STARTUP         = "system_startup"


@dataclass
class AuditEntry:
    id:          str
    event_type:  str   # AuditEventType value
    timestamp:   int   # unix seconds
    actor:       str   # "operator" | "guardian" | "system"
    symbol:      Optional[str]
    side:        Optional[str]
    quantity:    Optional[float]
    price:       Optional[float]
    reason:      Optional[str]
    order_id:    Optional[str]
    mode:        Optional[str]
    extra:       Optional[dict]


# ---------------------------------------------------------------------------
# In-process audit buffer (replaced by DB append in Phase 11)
# ---------------------------------------------------------------------------

_audit_buffer: list[AuditEntry] = []
_entry_counter: int = 0


def _next_id() -> str:
    global _entry_counter
    _entry_counter += 1
    return f"audit-{int(time.time())}-{_entry_counter}"


async def _get_redis():
    try:
        import aioredis  # type: ignore
        from backend.config.loader import get_redis_config
        cfg = get_redis_config()
        return await aioredis.from_url(cfg.url, decode_responses=True)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Append functions
# ---------------------------------------------------------------------------

async def append(
    event_type:  AuditEventType,
    actor:       str,
    reason:      Optional[str]  = None,
    symbol:      Optional[str]  = None,
    side:        Optional[str]  = None,
    quantity:    Optional[float] = None,
    price:       Optional[float] = None,
    order_id:    Optional[str]  = None,
    mode:        Optional[str]  = None,
    extra:       Optional[dict] = None,
) -> AuditEntry:
    """
    Append an audit entry. Writes to in-process buffer and Redis.
    Phase 11 adds DB write here.
    """
    entry = AuditEntry(
        id=_next_id(),
        event_type=event_type.value,
        timestamp=int(time.time()),
        actor=actor,
        symbol=symbol,
        side=side,
        quantity=quantity,
        price=price,
        reason=reason,
        order_id=order_id,
        mode=mode,
        extra=extra,
    )
    _audit_buffer.append(entry)
    # Keep buffer bounded
    if len(_audit_buffer) > 10_000:
        _audit_buffer.pop(0)

    # Write to Redis (durable across process restarts until Phase 11)
    r = await _get_redis()
    if r:
        try:
            await r.lpush("audit:log", json.dumps(asdict(entry)))
            await r.ltrim("audit:log", 0, 9999)
        except Exception as exc:
            log.warning("Audit Redis write failed: %s", exc)

    log.info("[audit] %s actor=%s reason=%s symbol=%s",
             event_type.value, actor, reason, symbol)
    return entry


async def append_kill_switch_manual(reason: str, actor: str = "operator") -> AuditEntry:
    return await append(
        event_type=AuditEventType.KILL_SWITCH_MANUAL,
        actor=actor, reason=reason,
    )


async def append_kill_switch_guardian(reason: str) -> AuditEntry:
    return await append(
        event_type=AuditEventType.KILL_SWITCH_GUARDIAN,
        actor="guardian", reason=reason,
    )


async def append_kill_switch_deactivate(reason: str, actor: str = "operator") -> AuditEntry:
    return await append(
        event_type=AuditEventType.KILL_SWITCH_DEACTIVATE,
        actor=actor, reason=reason,
    )


async def append_order_event(
    event_type:  AuditEventType,
    order_id:    str,
    symbol:      str,
    side:        str,
    quantity:    float,
    price:       Optional[float],
    mode:        str,
    reason:      Optional[str] = None,
) -> AuditEntry:
    return await append(
        event_type=event_type, actor="engine",
        symbol=symbol, side=side, quantity=quantity,
        price=price, order_id=order_id, mode=mode, reason=reason,
    )


# ---------------------------------------------------------------------------
# Read functions
# ---------------------------------------------------------------------------

def get_recent_entries(limit: int = 100) -> list[AuditEntry]:
    """Return most recent entries (newest first)."""
    return list(reversed(_audit_buffer[-limit:]))


async def get_entries_from_redis(limit: int = 100) -> list[dict]:
    """Read from Redis list (newest first, up to limit)."""
    r = await _get_redis()
    if r:
        try:
            items = await r.lrange("audit:log", 0, limit - 1)
            return [json.loads(i) for i in items]
        except Exception:
            pass
    return [dict(e.__dict__) if hasattr(e, '__dict__') else e for e in get_recent_entries(limit)]
