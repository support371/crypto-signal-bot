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
  - Reconciliation drift (OMS/open-order state mismatch vs execution venue)
  - Strategy-level kill switches
  - Venue-level kill switches

Outputs:
  - Kill switch activation (writes to Redis: KILL_SWITCH:active = 1)
  - GuardianStatus (for GET /guardian/status)
  - WebSocket guardian_alert events
  - Engine auto-halt on heartbeat loss
  - Engine auto-halt on persistent reconciliation drift
  - Scoped strategy/venue execution blocks

RULE 5: Risk always overrides strategy.
RULE 8: Guardian is not cosmetic.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Iterable, Optional

from backend.config.loader import get_redis_config, get_risk_config
from backend.logic import context

log = logging.getLogger(__name__)


@dataclass
class GuardianThresholds:
    max_drawdown_pct: float
    max_daily_loss_pct: float
    max_api_errors: int
    max_failed_orders: int
    heartbeat_timeout_s: int = 90
    reconciliation_drift_tolerance_cycles: int = 3


@dataclass
class GuardianStatus:
    kill_switch_active: bool
    triggered: bool
    kill_switch_reason: Optional[str]
    trigger_reason: Optional[str]
    drawdown_pct: float
    daily_loss_pct: float
    api_error_count: int
    failed_order_count: int
    thresholds: GuardianThresholds
    market_data: Optional[dict]
    last_heartbeat_at: Optional[int]
    heartbeat_healthy: bool
    computed_at: int
    reconciliation_drift_count: int = 0
    reconciliation_drift_active: bool = False
    reconciliation_drift_reason: Optional[str] = None
    strategy_kill_switches: tuple[str, ...] = ()
    venue_kill_switches: tuple[str, ...] = ()
    in_cooldown: bool = False
    cooldown_remaining_s: int = 0


class TradingScopeHaltedError(Exception):
    """Raised when a scoped strategy or venue kill switch blocks execution."""


_kill_switch_active: bool = False
_kill_switch_reason: Optional[str] = None
_triggered: bool = False
_trigger_reason: Optional[str] = None
_drawdown_pct: float = 0.0
_daily_loss_pct: float = 0.0
_api_error_count: int = 0
_failed_order_count: int = 0
_last_heartbeat_at: Optional[int] = None
_kill_switch_at: Optional[int] = None
_kill_switch_deactivated_at: Optional[int] = None   # timestamp of last deactivation
_reconciliation_drift_count: int = 0
_reconciliation_drift_reason: Optional[str] = None
_strategy_kill_switches: set[str] = set()
_venue_kill_switches: set[str] = set()

_loop_task: Optional[asyncio.Task] = None
_loop_running: bool = False
_redis_client = None

# Runtime threshold overrides — None means use config value
_rt_max_drawdown_pct:   Optional[float] = None
_rt_max_daily_loss_pct: Optional[float] = None
_rt_max_api_errors:     Optional[int]   = None
_rt_max_failed_orders:  Optional[int]   = None


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
            raise


async def _publish_guardian_event(event_type: str, reason: str, **extra) -> None:
    r = await _get_redis()
    if r:
        try:
            payload = {"type": event_type, "reason": reason, "ts": int(time.time()), **extra}
            await r.publish("guardian_updates", json.dumps(payload))
        except Exception as exc:
            log.warning("Failed to publish guardian event: %s", exc)


async def activate_kill_switch(reason: str, source: str = "guardian") -> None:
    global _kill_switch_active, _kill_switch_reason, _triggered, _trigger_reason, _kill_switch_at
    log.warning("[guardian] KILL SWITCH ACTIVATED: %s (source=%s)", reason, source)
    _kill_switch_active = True
    _kill_switch_reason = reason
    _triggered = True
    _trigger_reason = reason
    _kill_switch_at = int(time.time())
    # Mirror into shared context so /guardian/status (which now reads
    # context.*) reflects guardian-initiated auto-halts.
    context.kill_switch_active = True
    context.kill_switch_reason = reason
    context.guardian_triggered = True
    context.guardian_trigger_reason = reason
    context.guardian_trigger_ts = float(_kill_switch_at)
    await _set_kill_switch_redis(True, reason)
    await _publish_guardian_event("kill_switch", reason=reason, active=True, source=source)
    await _publish_guardian_event("guardian_alert", reason=f"Kill switch activated: {reason}", source=source)


async def deactivate_kill_switch(reason: str = "Manual operator reset") -> None:
    global _kill_switch_active, _kill_switch_reason, _kill_switch_deactivated_at
    log.info("[guardian] Kill switch deactivated: %s", reason)
    _kill_switch_active = False
    _kill_switch_reason = None
    _kill_switch_deactivated_at = int(time.time())  # start cooldown window
    # Mirror into shared context.
    context.kill_switch_active = False
    context.kill_switch_reason = None
    await _set_kill_switch_redis(False, "")
    await _publish_guardian_event("kill_switch", reason=reason, active=False)


def get_cooldown_seconds() -> int:
    """Cooldown window (seconds) after kill switch deactivation before trading resumes."""
    try:
        from backend.config.loader import get_settings
        return int(getattr(get_settings(), "cooldown_seconds", 60))
    except Exception:
        return 60


def is_in_cooldown() -> bool:
    """Return True if we are inside the post-kill-switch cooldown window."""
    if _kill_switch_deactivated_at is None:
        return False
    elapsed = int(time.time()) - _kill_switch_deactivated_at
    return elapsed < get_cooldown_seconds()


def cooldown_remaining_seconds() -> int:
    """Seconds remaining in cooldown, or 0 if not in cooldown."""
    if _kill_switch_deactivated_at is None:
        return 0
    remaining = get_cooldown_seconds() - (int(time.time()) - _kill_switch_deactivated_at)
    return max(remaining, 0)


async def is_kill_switch_active() -> bool:
    try:
        r = await _get_redis()
        if r:
            val = await r.get("KILL_SWITCH:active")
            return val == "1"
    except Exception:
        pass
    return _kill_switch_active


def _normalize_scope_id(scope_id: str) -> str:
    normalized = str(scope_id).strip().lower()
    if not normalized:
        raise ValueError("scope id must be non-empty")
    return normalized


async def kill_strategy(strategy_id: str, reason: str = "operator strategy halt") -> None:
    normalized = _normalize_scope_id(strategy_id)
    _strategy_kill_switches.add(normalized)
    await _publish_guardian_event("strategy_kill_switch", reason=reason, strategy_id=normalized, active=True)


async def revive_strategy(strategy_id: str, reason: str = "operator strategy reset") -> None:
    normalized = _normalize_scope_id(strategy_id)
    _strategy_kill_switches.discard(normalized)
    await _publish_guardian_event("strategy_kill_switch", reason=reason, strategy_id=normalized, active=False)


async def kill_venue(venue_id: str, reason: str = "operator venue halt") -> None:
    normalized = _normalize_scope_id(venue_id)
    _venue_kill_switches.add(normalized)
    await _publish_guardian_event("venue_kill_switch", reason=reason, venue_id=normalized, active=True)


async def revive_venue(venue_id: str, reason: str = "operator venue reset") -> None:
    normalized = _normalize_scope_id(venue_id)
    _venue_kill_switches.discard(normalized)
    await _publish_guardian_event("venue_kill_switch", reason=reason, venue_id=normalized, active=False)


def is_strategy_killed(strategy_id: str) -> bool:
    return _normalize_scope_id(strategy_id) in _strategy_kill_switches


def is_venue_killed(venue_id: str) -> bool:
    return _normalize_scope_id(venue_id) in _venue_kill_switches


def assert_scope_allowed(strategy_id: str | None = None, venue_id: str | None = None) -> bool:
    if strategy_id and is_strategy_killed(strategy_id):
        raise TradingScopeHaltedError(f"Strategy '{_normalize_scope_id(strategy_id)}' is kill-switched.")
    if venue_id and is_venue_killed(venue_id):
        raise TradingScopeHaltedError(f"Venue '{_normalize_scope_id(venue_id)}' is kill-switched.")
    return True


async def on_api_error() -> None:
    global _api_error_count
    _api_error_count += 1
    # Mirror into shared context so /guardian/status reflects the count.
    context.api_error_count = _api_error_count
    cfg = get_risk_config()
    if _api_error_count >= cfg.max_api_errors:
        await activate_kill_switch(
            f"API error threshold reached ({_api_error_count}/{cfg.max_api_errors})",
            source="guardian_auto",
        )


async def on_failed_order() -> None:
    global _failed_order_count
    _failed_order_count += 1
    # Mirror into shared context so /guardian/status reflects the count.
    context.failed_order_count = _failed_order_count
    cfg = get_risk_config()
    if _failed_order_count >= cfg.max_failed_orders:
        await activate_kill_switch(
            f"Failed order threshold reached ({_failed_order_count}/{cfg.max_failed_orders})",
            source="guardian_auto",
        )


async def update_drawdown(drawdown_pct: float) -> None:
    global _drawdown_pct
    _drawdown_pct = drawdown_pct
    # Mirror into shared context so /guardian/status reflects the drawdown.
    context.guardian_drawdown_pct = drawdown_pct
    cfg = get_risk_config()
    if drawdown_pct >= cfg.max_drawdown_pct and not _kill_switch_active:
        await activate_kill_switch(
            f"Drawdown threshold breached ({drawdown_pct:.1f}% >= {cfg.max_drawdown_pct}%)",
            source="guardian_auto",
        )


async def update_daily_loss(daily_loss_pct: float) -> None:
    global _daily_loss_pct
    _daily_loss_pct = daily_loss_pct


def record_heartbeat() -> None:
    global _last_heartbeat_at
    _last_heartbeat_at = int(time.time())


def reset_counters() -> None:
    global _api_error_count, _failed_order_count, _triggered, _trigger_reason
    _api_error_count = 0
    _failed_order_count = 0
    _triggered = False
    _trigger_reason = None
    # Mirror into shared context so /guardian/status reflects the reset.
    context.api_error_count = 0
    context.failed_order_count = 0
    context.guardian_triggered = False
    context.guardian_trigger_reason = None


def _normalize_open_order_ids(order_ids: Iterable[str]) -> set[str]:
    return {str(order_id).strip() for order_id in order_ids if str(order_id).strip()}


async def on_reconciliation_check(
    *,
    local_open_order_ids: Iterable[str],
    venue_open_order_ids: Iterable[str],
    tolerance_cycles: int = 3,
) -> bool:
    global _reconciliation_drift_count, _reconciliation_drift_reason
    local_ids = _normalize_open_order_ids(local_open_order_ids)
    venue_ids = _normalize_open_order_ids(venue_open_order_ids)
    missing_on_venue = sorted(local_ids - venue_ids)
    unknown_on_venue = sorted(venue_ids - local_ids)
    if not missing_on_venue and not unknown_on_venue:
        _reconciliation_drift_count = 0
        _reconciliation_drift_reason = None
        return True
    _reconciliation_drift_count += 1
    _reconciliation_drift_reason = (
        "Reconciliation drift detected: "
        f"missing_on_venue={missing_on_venue}; unknown_on_venue={unknown_on_venue}"
    )
    if _reconciliation_drift_count >= tolerance_cycles and not _kill_switch_active:
        await activate_kill_switch(
            f"Persistent reconciliation drift after {_reconciliation_drift_count} cycles: "
            f"missing_on_venue={missing_on_venue}; unknown_on_venue={unknown_on_venue}",
            source="guardian_reconciliation",
        )
        return False
    return True


async def _check_heartbeat(thresholds: GuardianThresholds) -> None:
    if _last_heartbeat_at is None:
        return
    age = int(time.time()) - _last_heartbeat_at
    if age > thresholds.heartbeat_timeout_s and not _kill_switch_active:
        await activate_kill_switch(
            f"Engine heartbeat lost ({age}s > {thresholds.heartbeat_timeout_s}s timeout)",
            source="guardian_heartbeat",
        )


async def _check_exchange_health() -> dict:
    try:
        from backend.services.market_data.service import get_exchange_status
        status = await get_exchange_status()
        return {
            "connected": status.connected,
            "market_data_mode": status.market_data_mode,
            "connection_state": status.connection_state,
            "fallback_active": False,
            "stale": status.stale,
            "source": status.source,
        }
    except Exception as exc:
        return {
            "connected": False,
            "market_data_mode": "unavailable",
            "connection_state": "offline",
            "fallback_active": False,
            "stale": True,
            "source": None,
            "error": str(exc),
        }


async def get_guardian_status() -> GuardianStatus:
    cfg = get_risk_config()
    rt = get_runtime_thresholds()
    thresholds = GuardianThresholds(
        max_drawdown_pct=rt["max_drawdown_pct"],
        max_daily_loss_pct=rt["max_daily_loss_pct"],
        max_api_errors=rt["max_api_errors"],
        max_failed_orders=rt["max_failed_orders"],
    )
    market_data = await _check_exchange_health()
    heartbeat_ok = (
        _last_heartbeat_at is not None
        and (int(time.time()) - _last_heartbeat_at) < thresholds.heartbeat_timeout_s
    )
    # Read from context.* (the live state updated by app.py) for fields
    # that the main app flow maintains, falling back to service-local vars
    # for fields only the guardian service manages.
    return GuardianStatus(
        # Prefer module-level vars (source of truth) over context vars
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
        reconciliation_drift_count=_reconciliation_drift_count,
        reconciliation_drift_active=_reconciliation_drift_count > 0,
        reconciliation_drift_reason=_reconciliation_drift_reason,
        strategy_kill_switches=tuple(sorted(_strategy_kill_switches)),
        venue_kill_switches=tuple(sorted(_venue_kill_switches)),
        in_cooldown=is_in_cooldown(),
        cooldown_remaining_s=cooldown_remaining_seconds(),
    )


_GUARDIAN_INTERVAL_SECONDS = 10

async def _guardian_loop() -> None:
    global _loop_running
    _loop_running = True
    log.info("[guardian] Loop started.")
    while _loop_running:
        try:
            cfg = get_risk_config()
            rt = get_runtime_thresholds()
            thresholds = GuardianThresholds(
                max_drawdown_pct=rt["max_drawdown_pct"],
                max_daily_loss_pct=rt["max_daily_loss_pct"],
                max_api_errors=rt["max_api_errors"],
                max_failed_orders=rt["max_failed_orders"],
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


# ─────────────────────────────────────────────────────────────────
# Runtime threshold management (console layer)
# ─────────────────────────────────────────────────────────────────

def get_runtime_thresholds() -> dict:
    """
    Return current effective thresholds — merging config defaults with
    any operator overrides set via set_runtime_thresholds().
    """
    cfg = get_risk_config()
    return {
        "max_drawdown_pct":   _rt_max_drawdown_pct   if _rt_max_drawdown_pct   is not None else cfg.max_drawdown_pct,
        "max_daily_loss_pct": _rt_max_daily_loss_pct if _rt_max_daily_loss_pct is not None else 10.0,
        "max_api_errors":     _rt_max_api_errors     if _rt_max_api_errors     is not None else cfg.max_api_errors,
        "max_failed_orders":  _rt_max_failed_orders  if _rt_max_failed_orders  is not None else cfg.max_failed_orders,
        "overridden": any(v is not None for v in (
            _rt_max_drawdown_pct, _rt_max_daily_loss_pct,
            _rt_max_api_errors, _rt_max_failed_orders,
        )),
    }


def set_runtime_thresholds(
    max_drawdown_pct:   Optional[float] = None,
    max_daily_loss_pct: Optional[float] = None,
    max_api_errors:     Optional[int]   = None,
    max_failed_orders:  Optional[int]   = None,
) -> dict:
    """
    Override one or more guardian thresholds at runtime.
    Pass None for a field to leave it unchanged.
    Returns the new effective thresholds.
    """
    global _rt_max_drawdown_pct, _rt_max_daily_loss_pct
    global _rt_max_api_errors, _rt_max_failed_orders

    if max_drawdown_pct is not None:
        if max_drawdown_pct <= 0 or max_drawdown_pct > 100:
            raise ValueError("max_drawdown_pct must be in (0, 100]")
        _rt_max_drawdown_pct = float(max_drawdown_pct)

    if max_daily_loss_pct is not None:
        if max_daily_loss_pct <= 0 or max_daily_loss_pct > 100:
            raise ValueError("max_daily_loss_pct must be in (0, 100]")
        _rt_max_daily_loss_pct = float(max_daily_loss_pct)

    if max_api_errors is not None:
        if max_api_errors < 1:
            raise ValueError("max_api_errors must be >= 1")
        _rt_max_api_errors = int(max_api_errors)

    if max_failed_orders is not None:
        if max_failed_orders < 1:
            raise ValueError("max_failed_orders must be >= 1")
        _rt_max_failed_orders = int(max_failed_orders)

    log.info(
        "[guardian] Runtime thresholds updated: drawdown=%.1f%% daily_loss=%.1f%% "
        "api_errors=%s failed_orders=%s",
        _rt_max_drawdown_pct or -1, _rt_max_daily_loss_pct or -1,
        _rt_max_api_errors, _rt_max_failed_orders,
    )
    return get_runtime_thresholds()


def reset_runtime_thresholds() -> dict:
    """Clear all runtime overrides — revert to config defaults."""
    global _rt_max_drawdown_pct, _rt_max_daily_loss_pct
    global _rt_max_api_errors, _rt_max_failed_orders
    _rt_max_drawdown_pct = None
    _rt_max_daily_loss_pct = None
    _rt_max_api_errors = None
    _rt_max_failed_orders = None
    log.info("[guardian] Runtime thresholds cleared — reverted to config defaults")
    return get_runtime_thresholds()
