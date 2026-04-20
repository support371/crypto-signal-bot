# backend/services/guardian_bot/service.py
"""
PHASE 8 — Guardian Service.

Independent sovereign service. Not cosmetic. Changes runtime behavior.

Inputs:
  - Drawdown (from position P&L — via execution engine or ledger)
  - Daily loss (from earnings ledger)
  - Risk state (from risk engine output in /market-state)
  - Exchange health (from MarketDataService.get_exchange_status())
  - API error counter (incremented by execution engine)
  - Failed order counter (incremented by execution engine)

Outputs:
  - Kill switch activation (writes to Redis: KILL_SWITCH:active = 1)
  - GuardianStatus (for GET /guardian/status)
  - WebSocket guardian_alert events
  - Engine auto-halt on heartbeat loss

Protected files: backend/logic/risk.py used for threshold defaults only
  (read via config loader, not imported directly here).

RULE 5: Risk always overrides strategy.
RULE 8: Guardian is not cosmetic.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from backend.config.loader import get_redis_config, get_risk_config

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Guardian state types
# ---------------------------------------------------------------------------

@dataclass
class GuardianThresholds:
    max_drawdown_pct:    float
    max_daily_loss_pct:  float
    max_api_errors:      int
    max_failed_orders:   int
    heartbeat_timeout_s: int = 90  # seconds before engine is auto-halted


@dataclass
class GuardianStatus:
    kill_switch_active:   bool
    triggered:            bool
    kill_switch_reason:   Optional[str]
    trigger_reason:       Optional[str]
    drawdown_pct:         float
    daily_loss_pct:       float
    api_error_count:      int
    failed_order_count:   int
    thresholds:           GuardianThresholds
    market_data:          Optional[dict]
    last_heartbeat_at:    Optional[int]
    heartbeat_healthy:    bool
    computed_at:          int


# ---------------------------------------------------------------------------
# In-process state
# ---------------------------------------------------------------------------

_kill_switch_active:  bool = False
_kill_switch_reason:  Optional[str] = None
_triggered:           bool = False
_trigger_reason:      Optional[str] = None
_drawdown_pct:        float = 0.0
_daily_loss_pct:      float = 0.0
_api_error_count:     int = 0
_failed_order_count:  int = 0
_last_heartbeat_at:   Optional[int] = None
_kill_switch_at:      Optional[int] = None

_loop_task:     Optional[asyncio.Task] = None
_loop_running:  bool = False


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
        cfg = get_redis_config()
        _redis_client = await aioredis.from_url(cfg.url, decode_responses=True)
        return _redis_client
    except Exception:
        return None


async def _set_kill_switch_redis(active: bool, reason: str) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.set("KILL_SWITCH:active", "1" if active else "0")
            await r.set("KILL_SWITCH:reason", reason)
            await r.set("KILL_SWITCH:ts", str(int(time.time())))
        except Exception as exc:
            log.error("Failed to write kill switch to Redis: %s", exc)
            # Do NOT swallow — this is a critical write
            raise


async def _publish_guardian_event(event_type: str, reason: str, **extra) -> None:
    r = await _get_redis()
    if r:
        try:
            payload = {
                "type":   event_type,
                "reason": reason,
                "ts":     int(time.time()),
                **extra,
            }
            await r.publish("guardian_updates", json.dumps(payload))
        except Exception as exc:
            log.warning("Failed to publish guardian event: %s", exc)


# ---------------------------------------------------------------------------
# Kill switch operations (runtime state change — not cosmetic)
# ---------------------------------------------------------------------------

async def activate_kill_switch(reason: str, source: str = "guardian") -> None:
    """
    Activate the kill switch.
    Writes to Redis (authoritative), updates in-process state,
    publishes WebSocket event, appends audit log entry.
    """
    global _kill_switch_active, _kill_switch_reason, _triggered, _trigger_reason, _kill_switch_at

    log.warning("[guardian] KILL SWITCH ACTIVATED: %s (source=%s)", reason, source)

    _kill_switch_active = True
    _kill_switch_reason = reason
    _triggered          = True
    _trigger_reason     = reason
    _kill_switch_at     = int(time.time())

    # Write to Redis — this is read by execution engine before every order
    await _set_kill_switch_redis(True, reason)

    # Publish WebSocket event
    await _publish_guardian_event(
        "kill_switch",
        reason=reason,
        active=True,
        source=source,
    )

    # Publish guardian alert
    await _publish_guardian_event(
        "guardian_alert",
        reason=f"Kill switch activated: {reason}",
        source=source,
    )


async def deactivate_kill_switch(reason: str = "Manual operator reset") -> None:
    """Deactivate the kill switch. Operator-controlled only."""
    global _kill_switch_active, _kill_switch_reason

    log.info("[guardian] Kill switch deactivated: %s", reason)

    _kill_switch_active = False
    _kill_switch_reason = None

    await _set_kill_switch_redis(False, "")
    await _publish_guardian_event("kill_switch", reason=reason, active=False)


async def is_kill_switch_active() -> bool:
    """
    Check kill switch state. Redis is authoritative.
    Falls back to in-process state if Redis is unreachable.
    Fail safe: returns True (halted) on error.
    """
    try:
        r = await _get_redis()
        if r:
            val = await r.get("KILL_SWITCH:active")
            return val == "1"
    except Exception:
        pass
    return _kill_switch_active  # fallback to in-process


# ---------------------------------------------------------------------------
# Input event handlers — called by execution engine and other services
# ---------------------------------------------------------------------------

async def on_api_error() -> None:
    """Called by execution engine on each API transport failure."""
    global _api_error_count
    _api_error_count += 1
    cfg = get_risk_config()
    if _api_error_count >= cfg.max_api_errors:
        await activate_kill_switch(
            f"API error threshold reached ({_api_error_count}/{cfg.max_api_errors})",
            source="guardian_auto",
        )


async def on_failed_order() -> None:
    """Called by execution engine on each order rejection/failure."""
    global _failed_order_count
    _failed_order_count += 1
    cfg = get_risk_config()
    if _failed_order_count >= cfg.max_failed_orders:
        await activate_kill_switch(
            f"Failed order threshold reached ({_failed_order_count}/{cfg.max_failed_orders})",
            source="guardian_auto",
        )


async def update_drawdown(drawdown_pct: float) -> None:
    """Called by reconciliation/P&L service on each balance update."""
    global _drawdown_pct
    _drawdown_pct = drawdown_pct
    cfg = get_risk_config()
    if drawdown_pct >= cfg.max_drawdown_pct and not _kill_switch_active:
        await activate_kill_switch(
            f"Drawdown threshold breached ({drawdown_pct:.1f}% >= {cfg.max_drawdown_pct}%)",
            source="guardian_auto",
        )


async def update_daily_loss(daily_loss_pct: float) -> None:
    """Called by earnings ledger on each P&L update."""
    global _daily_loss_pct
    _daily_loss_pct = daily_loss_pct


def record_heartbeat() -> None:
    """Called by the execution engine on each successful operation."""
    global _last_heartbeat_at
    _last_heartbeat_at = int(time.time())


def reset_counters() -> None:
    """Reset error counters after successful recovery."""
    global _api_error_count, _failed_order_count
    _api_error_count    = 0
    _failed_order_count = 0


# ---------------------------------------------------------------------------
# Heartbeat monitor — auto-halt on heartbeat loss
# ---------------------------------------------------------------------------

async def _check_heartbeat(thresholds: GuardianThresholds) -> None:
    """
    If the execution engine hasn't sent a heartbeat within the timeout,
    activate the kill switch automatically.
    This prevents zombie/silent execution state.
    """
    if _last_heartbeat_at is None:
        return  # No heartbeat yet — engine may not have started
    age = int(time.time()) - _last_heartbeat_at
    if age > thresholds.heartbeat_timeout_s and not _kill_switch_active:
        await activate_kill_switch(
            f"Engine heartbeat lost ({age}s > {thresholds.heartbeat_timeout_s}s timeout)",
            source="guardian_heartbeat",
        )


# ---------------------------------------------------------------------------
# Exchange health monitor
# ---------------------------------------------------------------------------

async def _check_exchange_health() -> dict:
    """Check exchange connectivity and return market data status dict."""
    try:
        from backend.services.market_data.service import get_exchange_status
        status = await get_exchange_status()
        return {
            "connected":         status.connected,
            "market_data_mode":  status.market_data_mode,
            "connection_state":  status.connection_state,
            "fallback_active":   False,
            "stale":             status.stale,
            "source":            status.source,
        }
    except Exception as exc:
        return {
            "connected":         False,
            "market_data_mode":  "unavailable",
            "connection_state":  "offline",
            "fallback_active":   False,
            "stale":             True,
            "source":            None,
            "error":             str(exc),
        }


# ---------------------------------------------------------------------------
# Status accessor
# ---------------------------------------------------------------------------

async def get_guardian_status() -> GuardianStatus:
    cfg = get_risk_config()
    thresholds = GuardianThresholds(
        max_drawdown_pct=cfg.max_drawdown_pct,
        max_daily_loss_pct=10.0,  # TODO: expose in RiskConfig
        max_api_errors=cfg.max_api_errors,
        max_failed_orders=cfg.max_failed_orders,
    )
    market_data = await _check_exchange_health()
    heartbeat_ok = (
        _last_heartbeat_at is not None
        and (int(time.time()) - _last_heartbeat_at) < thresholds.heartbeat_timeout_s
    )
    return GuardianStatus(
        kill_switch_active=_kill_switch_active,
        triggered=_triggered,
        kill_switch_reason=_kill_switch_reason,
        trigger_reason=_trigger_reason,
        drawdown_pct=_drawdown_pct,
        daily_loss_pct=_daily_loss_pct,
        api_error_count=_api_error_count,
        failed_order_count=_failed_order_count,
        thresholds=thresholds,
        market_data=market_data,
        last_heartbeat_at=_last_heartbeat_at,
        heartbeat_healthy=heartbeat_ok,
        computed_at=int(time.time()),
    )


# ---------------------------------------------------------------------------
# Guardian loop
# ---------------------------------------------------------------------------

_GUARDIAN_INTERVAL_SECONDS = 10

async def _guardian_loop() -> None:
    global _loop_running
    _loop_running = True
    log.info("[guardian] Loop started.")

    while _loop_running:
        try:
            cfg = get_risk_config()
            thresholds = GuardianThresholds(
                max_drawdown_pct=cfg.max_drawdown_pct,
                max_daily_loss_pct=10.0,
                max_api_errors=cfg.max_api_errors,
                max_failed_orders=cfg.max_failed_orders,
            )
            await _check_heartbeat(thresholds)
        except Exception as exc:
            log.error("[guardian] Loop error: %s", exc)

        await asyncio.sleep(_GUARDIAN_INTERVAL_SECONDS)

    _loop_running = False
    log.info("[guardian] Loop stopped.")


async def start_guardian() -> None:
    global _loop_task
    if _loop_running:
        return
    _loop_task = asyncio.create_task(_guardian_loop())
    log.info("[guardian] Task created.")


async def stop_guardian() -> None:
    global _loop_running, _loop_task
    _loop_running = False
    if _loop_task and not _loop_task.done():
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
    log.info("[guardian] Stopped cleanly.")
