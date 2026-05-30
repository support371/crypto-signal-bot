# backend/routes/console_v1.py
"""
Phase 5 — Command Console.

Operator-facing REST API that exposes unified system control and
observability in a single prefix: /api/v1/console/...

Endpoints
---------
GET  /status              — Full system snapshot (signals, guardian,
                            portfolio summary, circuit breakers)
GET  /audit               — Paginated audit trail
POST /trade               — Manual trade with optional signal-gate bypass
POST /signal-override     — Per-symbol signal gate override (one trade window)
POST /signal-reeval       — Force re-evaluation of one or all symbols
POST /kill-switch         — Activate / deactivate kill switch
POST /guardian/reset      — Reset guardian counters
GET  /guardian/status     — Guardian status (same as /api/v1/guardian/status)

Auth
----
All write endpoints require X-API-Key when auth is enabled.
Read endpoints are public so the dashboard can render without credentials.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.config.loader import get_auth_config
from backend.engine.coordinator import (
    ExecutionIntent,
    IntentValidationError,
    KillSwitchActive,
    RiskGateDenied,
    SignalGateDenied,
    execute_intent,
)
from backend.engine.routing import ExecutionFailed, ExecutionRejected
from backend.services.audit.service import (
    append_kill_switch_deactivate,
    append_kill_switch_manual,
    get_recent_entries,
)
from backend.services.guardian_bot.service import (
    activate_kill_switch,
    deactivate_kill_switch,
    get_guardian_status,
    reset_counters,
)
from backend.services.portfolio.service import get_portfolio_summary
from backend.services.signal_service.service import (
    evaluate_signal,
    get_all_cached_signals,
    get_cached_signal,
    get_signal_service_status,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/console", tags=["console"])

# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

def _require_operator(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    auth = get_auth_config()
    if not auth.auth_enabled:
        return
    if not x_api_key or x_api_key != auth.api_key:
        raise HTTPException(status_code=401, detail="X-API-Key required for console write endpoints.")


# ---------------------------------------------------------------------------
# Signal gate — per-symbol one-trade override store (delegated to engine layer)
# ---------------------------------------------------------------------------

from backend.engine.signal_override import (
    cancel_override as _cancel_override,
    consume_override as consume_signal_override,
    get_all_overrides,
    is_overridden as is_signal_overridden,
    set_override as _set_override,
)

_OVERRIDE_TTL = 300  # default 5 minutes


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

@router.get("/status", summary="Full system status snapshot")
async def console_status() -> dict:
    """
    Single aggregated view of the entire system state.
    Designed to power the Command Console dashboard.
    """
    guardian = await get_guardian_status()
    portfolio = await get_portfolio_summary()
    signal_status = get_signal_service_status()
    signals = [
        {
            "symbol":      r.symbol,
            "side":        r.side,
            "confidence":  round(r.confidence, 4),
            "strategy_id": r.strategy_id,
            "valid_until": r.valid_until,
            "overridden":  is_signal_overridden(r.symbol),
        }
        for r in get_all_cached_signals()
    ]

    return {
        "ts": int(time.time()),
        "guardian": {
            "kill_switch_active": guardian.kill_switch_active,
            "triggered":         guardian.triggered,
            "kill_switch_reason": guardian.kill_switch_reason,
            "drawdown_pct":      round(guardian.drawdown_pct, 4),
            "daily_loss_pct":    round(guardian.daily_loss_pct, 4),
            "api_error_count":   guardian.api_error_count,
            "failed_order_count": guardian.failed_order_count,
            "last_heartbeat_at": guardian.last_heartbeat_at,
        },
        "portfolio": {
            "cash_balance": portfolio.get("cash_balance"),
            "equity":       portfolio.get("equity"),
            "drawdown_pct": portfolio.get("drawdown_pct"),
            "trade_count":  portfolio.get("trade_count"),
            "win_rate":     portfolio.get("win_rate"),
            "positions":    portfolio.get("positions", []),
        },
        "signals": {
            "running":  signal_status["running"],
            "symbols":  signals,
            "overrides": get_all_overrides(),
        },
        "market": guardian.market_data,
    }


# ---------------------------------------------------------------------------
# GET /audit
# ---------------------------------------------------------------------------

@router.get("/audit", summary="Recent audit trail entries")
async def console_audit(limit: int = 50) -> dict:
    limit = min(max(limit, 1), 500)
    entries = get_recent_entries(limit)
    return {
        "count":   len(entries),
        "entries": [e.__dict__ if hasattr(e, "__dict__") else e for e in entries],
    }


# ---------------------------------------------------------------------------
# POST /trade — manual order with optional signal-gate bypass
# ---------------------------------------------------------------------------

class TradeRequest(BaseModel):
    symbol:     str = Field(..., examples=["BTCUSDT"])
    side:       Literal["BUY", "SELL"]
    quantity:   Decimal = Field(..., gt=0)
    order_type: Literal["MARKET", "LIMIT"] = "MARKET"
    price:      Optional[Decimal] = None
    mode:       Literal["paper", "live"] = "paper"
    notes:      Optional[str] = None
    force:      bool = Field(
        False,
        description="When True, bypass the signal gate for this single order. "
                    "Requires operator auth. The override is one-shot.",
    )

    @field_validator("symbol")
    @classmethod
    def upper_symbol(cls, v: str) -> str:
        return v.upper()

    @field_validator("side")
    @classmethod
    def upper_side(cls, v: str) -> str:
        return v.upper()


class TradeResponse(BaseModel):
    order_id:     str
    status:       str
    fill_price:   Optional[float]
    filled_qty:   float
    venue:        str
    realized_pnl: Optional[float]
    elapsed_ms:   int
    signal_gate_bypassed: bool = False


@router.post("/trade", response_model=TradeResponse, status_code=201,
             summary="Manual trade — operator-initiated order",
             dependencies=[Depends(_require_operator)])
async def console_trade(body: TradeRequest) -> TradeResponse:
    """
    Submit a manual order through the full coordinator pipeline.

    When `force=True`, a one-shot signal-gate override is injected so the
    signal gate is bypassed for this order only.  Kill switch and risk gate
    are always enforced regardless of `force`.
    """
    bypassed = False

    if body.force:
        # Register a short-lived one-shot override so coordinator skips
        # the signal gate for this symbol on the next execute_intent call.
        _set_override(body.symbol, _OVERRIDE_TTL)
        log.warning(
            "[console] Signal gate override SET by operator: symbol=%s side=%s",
            body.symbol, body.side,
        )

    intent = ExecutionIntent(
        symbol=body.symbol,
        side=body.side,
        order_type=body.order_type,
        quantity=body.quantity,
        price=body.price,
        mode=body.mode,
        notes=body.notes,
    )

    try:
        result = await execute_intent(intent)
        bypassed = consume_signal_override(body.symbol)
        return TradeResponse(
            order_id=result.order_id,
            status=result.status,
            fill_price=float(result.fill_price) if result.fill_price else None,
            filled_qty=float(result.filled_qty),
            venue=result.venue,
            realized_pnl=float(result.realized_pnl) if result.realized_pnl else None,
            elapsed_ms=result.elapsed_ms,
            signal_gate_bypassed=bypassed,
        )
    except SignalGateDenied as exc:
        # Override was set but signal gate still fired — should not happen
        # because coordinator checks the override, but handle defensively.
        consume_signal_override(body.symbol)
        raise HTTPException(status_code=409, detail=f"Signal gate denied: {exc.reason}")
    except KillSwitchActive:
        consume_signal_override(body.symbol)
        raise HTTPException(status_code=503, detail="Kill switch active — trading halted")
    except RiskGateDenied as exc:
        consume_signal_override(body.symbol)
        raise HTTPException(status_code=409, detail=f"Risk gate denied: {exc.reason}")
    except (ExecutionFailed, ExecutionRejected) as exc:
        consume_signal_override(body.symbol)
        raise HTTPException(status_code=502, detail=str(exc))
    except IntentValidationError as exc:
        consume_signal_override(body.symbol)
        raise HTTPException(status_code=422, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /signal-override — register per-symbol gate bypass window
# ---------------------------------------------------------------------------

class SignalOverrideRequest(BaseModel):
    symbol: str
    ttl_seconds: int = Field(300, ge=30, le=3600,
                             description="Seconds until override expires (30–3600)")

    @field_validator("symbol")
    @classmethod
    def upper_symbol(cls, v: str) -> str:
        return v.upper()


@router.post("/signal-override", summary="Register a per-symbol signal gate override",
             dependencies=[Depends(_require_operator)])
async def set_signal_override(body: SignalOverrideRequest) -> dict:
    """
    Register a time-boxed signal gate override for one symbol.
    The override expires after `ttl_seconds` or after the first order
    that consumes it (whichever comes first).
    """
    exp = _set_override(body.symbol, body.ttl_seconds)
    log.warning(
        "[console] Signal gate override registered: symbol=%s ttl=%ds expires=%d",
        body.symbol, body.ttl_seconds, exp,
    )
    return {
        "symbol":      body.symbol,
        "override":    True,
        "expires_at":  exp,
        "ttl_seconds": body.ttl_seconds,
    }


@router.delete("/signal-override/{symbol}", summary="Cancel a signal gate override",
               dependencies=[Depends(_require_operator)])
async def cancel_signal_override(symbol: str) -> dict:
    sym = symbol.upper()
    removed = _cancel_override(sym)
    return {"symbol": sym, "override": False, "removed": removed}


# ---------------------------------------------------------------------------
# POST /signal-reeval — force background re-evaluation
# ---------------------------------------------------------------------------

class ReevalRequest(BaseModel):
    symbol: Optional[str] = Field(
        None,
        description="Symbol to re-evaluate. Omit to re-evaluate all tracked symbols.",
    )


@router.post("/signal-reeval", summary="Force signal re-evaluation",
             dependencies=[Depends(_require_operator)])
async def signal_reeval(body: ReevalRequest) -> dict:
    """
    Force an immediate signal evaluation outside the normal 60s loop.
    Returns the new signal(s).
    """
    from backend.services.signal_service.service import _SYMBOLS  # type: ignore[attr-defined]

    symbols_to_eval: List[str] = (
        [body.symbol.upper()] if body.symbol else list(_SYMBOLS)
    )

    results = []
    errors = []
    for sym in symbols_to_eval:
        try:
            rec = await evaluate_signal(sym)
            results.append({
                "symbol":      rec.symbol,
                "side":        rec.side,
                "confidence":  round(rec.confidence, 4),
                "strategy_id": rec.strategy_id,
                "valid_until": rec.valid_until,
            })
        except Exception as exc:
            errors.append({"symbol": sym, "error": str(exc)})

    return {
        "evaluated": len(results),
        "results":   results,
        "errors":    errors,
    }


# ---------------------------------------------------------------------------
# POST /kill-switch
# ---------------------------------------------------------------------------

class KillSwitchRequest(BaseModel):
    activate: bool
    reason:   Optional[str] = None


@router.post("/kill-switch", summary="Activate or deactivate the kill switch",
             dependencies=[Depends(_require_operator)])
async def console_kill_switch(body: KillSwitchRequest) -> dict:
    if body.activate:
        reason = body.reason or "Manual operator activation via console"
        await activate_kill_switch(reason, source="console")
        await append_kill_switch_manual(reason, actor="console_operator")
        return {"kill_switch_active": True, "action": "activated", "reason": reason}
    else:
        reason = body.reason or "Manual operator deactivation via console"
        await deactivate_kill_switch()
        await append_kill_switch_deactivate(reason, actor="console_operator")
        return {"kill_switch_active": False, "action": "deactivated", "reason": reason}


# ---------------------------------------------------------------------------
# POST /guardian/reset
# ---------------------------------------------------------------------------

class GuardianResetRequest(BaseModel):
    confirm: bool = Field(..., description="Must be True to proceed")


@router.post("/guardian/reset", summary="Reset guardian error counters",
             dependencies=[Depends(_require_operator)])
async def console_guardian_reset(body: GuardianResetRequest) -> dict:
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Set confirm=true to reset guardian counters")
    reset_counters()
    return {"reset": True, "ts": int(time.time())}


# ---------------------------------------------------------------------------
# GET /guardian/status
# ---------------------------------------------------------------------------

@router.get("/guardian/status", summary="Guardian status (console view)")
async def console_guardian_status() -> dict:
    g = await get_guardian_status()
    return {
        "kill_switch_active":  g.kill_switch_active,
        "triggered":           g.triggered,
        "kill_switch_reason":  g.kill_switch_reason,
        "trigger_reason":      g.trigger_reason,
        "drawdown_pct":        round(g.drawdown_pct, 4),
        "daily_loss_pct":      round(g.daily_loss_pct, 4),
        "api_error_count":     g.api_error_count,
        "failed_order_count":  g.failed_order_count,
        "last_heartbeat_at":   g.last_heartbeat_at,
        "thresholds": {
            "max_drawdown_pct":   g.thresholds.max_drawdown_pct,
            "max_daily_loss_pct": g.thresholds.max_daily_loss_pct,
            "max_api_errors":     g.thresholds.max_api_errors,
            "max_failed_orders":  g.thresholds.max_failed_orders,
        },
        "market": g.market_data,
        "computed_at": g.computed_at,
    }
