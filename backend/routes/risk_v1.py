# backend/routes/risk_v1.py
"""
Risk & Guardian REST API — V1

POST /api/v1/risk/evaluate         — pre-trade risk check (no execution)
GET  /api/v1/guardian/status       — full guardian runtime status
POST /api/v1/guardian/reset        — reset counters + optionally deactivate kill switch
GET  /api/v1/guardian/thresholds   — configured risk thresholds
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from backend.services.risk_gate.service import evaluate_order, RiskGateDecision
from backend.services.guardian_bot.service import (
    get_guardian_status, deactivate_kill_switch, reset_counters,
)
from backend.config.loader import get_risk_config

router = APIRouter(prefix="/api/v1", tags=["risk_v1"])


# ── Models ────────────────────────────────────────────────────────

class RiskEvalRequest(BaseModel):
    symbol:      str
    side:        str
    qty:         float
    price:       Optional[float] = None
    strategy_id: Optional[str]  = None
    venue_id:    Optional[str]  = None

    @field_validator("side")
    @classmethod
    def _side(cls, v):
        v = v.upper()
        if v not in ("BUY", "SELL"):
            raise ValueError("side must be BUY or SELL")
        return v

    @field_validator("qty")
    @classmethod
    def _qty(cls, v):
        if v <= 0:
            raise ValueError("qty must be positive")
        return v


class RiskEvalOut(BaseModel):
    approved:        bool
    order_qty:       float
    original_qty:    float
    size_multiplier: float
    kill_switch:     bool
    rules_passed:    List[str]
    rules_failed:    List[str]
    reasons:         List[str]
    risk_score:      float
    metadata:        Dict[str, Any]


class GuardianStatusOut(BaseModel):
    kill_switch_active:          bool
    triggered:                   bool
    kill_switch_reason:          Optional[str]
    trigger_reason:              Optional[str]
    drawdown_pct:                float
    api_error_count:             int
    failed_order_count:          int
    last_heartbeat_at:           Optional[int]
    heartbeat_healthy:           bool
    reconciliation_drift_count:  int
    reconciliation_drift_active: bool
    strategy_kill_switches:      List[str]
    venue_kill_switches:         List[str]
    thresholds:                  Dict[str, Any]
    computed_at:                 int


class GuardianResetRequest(BaseModel):
    deactivate_kill_switch: bool = False
    reason: Optional[str] = None


class GuardianResetOut(BaseModel):
    counters_reset:  bool
    kill_switch_was: bool
    kill_switch_now: bool
    reason:          str


# ── Routes ────────────────────────────────────────────────────────

@router.post("/risk/evaluate", response_model=RiskEvalOut,
             summary="Pre-trade risk evaluation (no execution)")
async def risk_evaluate(body: RiskEvalRequest) -> RiskEvalOut:
    d: RiskGateDecision = await evaluate_order(
        symbol=body.symbol, side=body.side, qty=body.qty,
        price=body.price, strategy_id=body.strategy_id, venue_id=body.venue_id,
    )
    return RiskEvalOut(**d.__dict__)


@router.get("/guardian/status", response_model=GuardianStatusOut,
            summary="Full guardian and kill-switch status")
async def guardian_status_v1() -> GuardianStatusOut:
    s = await get_guardian_status()
    return GuardianStatusOut(
        kill_switch_active=s.kill_switch_active,
        triggered=s.triggered,
        kill_switch_reason=s.kill_switch_reason,
        trigger_reason=s.trigger_reason,
        drawdown_pct=s.drawdown_pct,
        api_error_count=s.api_error_count,
        failed_order_count=s.failed_order_count,
        last_heartbeat_at=s.last_heartbeat_at,
        heartbeat_healthy=s.heartbeat_healthy,
        reconciliation_drift_count=s.reconciliation_drift_count,
        reconciliation_drift_active=s.reconciliation_drift_count > 0,
        strategy_kill_switches=list(s.strategy_kill_switches),
        venue_kill_switches=list(s.venue_kill_switches),
        thresholds={
            "max_drawdown_pct":   s.thresholds.max_drawdown_pct,
            "max_daily_loss_pct": s.thresholds.max_daily_loss_pct,
            "max_api_errors":     s.thresholds.max_api_errors,
            "max_failed_orders":  s.thresholds.max_failed_orders,
            "heartbeat_timeout_s": s.thresholds.heartbeat_timeout_s,
        },
        computed_at=s.computed_at,
    )


@router.post("/guardian/reset", response_model=GuardianResetOut,
             summary="Reset guardian counters, optionally deactivate kill switch")
async def guardian_reset(body: GuardianResetRequest) -> GuardianResetOut:
    s_before = await get_guardian_status()
    ks_was   = s_before.kill_switch_active
    reason   = body.reason or "Operator reset"

    reset_counters()
    if body.deactivate_kill_switch and ks_was:
        await deactivate_kill_switch(reason=reason)

    s_after = await get_guardian_status()
    return GuardianResetOut(
        counters_reset=True, kill_switch_was=ks_was,
        kill_switch_now=s_after.kill_switch_active, reason=reason,
    )


@router.get("/guardian/thresholds",
            summary="Configured risk thresholds")
async def guardian_thresholds() -> dict:
    cfg = get_risk_config()
    return {
        "max_drawdown_pct":       cfg.max_drawdown_pct,
        "max_api_errors":         cfg.max_api_errors,
        "max_failed_orders":      cfg.max_failed_orders,
        "risk_tolerance":         cfg.risk_tolerance,
        "position_size_fraction": cfg.position_size_fraction,
        "max_position_pct":       25.0,
        "max_total_exposure_pct": 95.0,
        "volatility_threshold_pct": 15.0,
        "fee_rate_pct":           0.10,
    }
