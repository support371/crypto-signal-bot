# backend/services/risk_gate/service.py
"""
Risk gate — pre-trade validation layer.

Every order flows through evaluate_order() before execution.
Checks (in order):
  1. Global kill switch
  2. Scoped strategy / venue kill switches
  3. RiskRuleEngine (MaxPosition, PortfolioExposure, MaxDailyLoss,
     Volatility, Leverage, Slippage) with LIVE portfolio state

Returns a RiskGateDecision — never raises.

RULE 5: Risk always overrides strategy — this gate is NOT optional.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Module-level import so tests can patch it
from backend.services.market_data.service import get_price as _get_price_fn

log = logging.getLogger(__name__)


@dataclass
class RiskGateDecision:
    approved:        bool
    order_qty:       float          # qty after size multiplier
    original_qty:    float
    size_multiplier: float
    kill_switch:     bool
    rules_passed:    List[str]
    rules_failed:    List[str]
    reasons:         List[str]
    risk_score:      float          # 0–100
    metadata:        Dict[str, Any] = field(default_factory=dict)


async def evaluate_order(
    symbol: str,
    side: str,
    qty: float,
    price: Optional[float] = None,
    strategy_id: Optional[str] = None,
    venue_id: Optional[str] = None,
) -> RiskGateDecision:
    """Pre-trade risk evaluation. Never raises."""
    try:
        return await _evaluate(symbol, side, qty, price, strategy_id, venue_id)
    except Exception as exc:
        log.error("risk_gate internal error (order blocked): %s", exc)
        return RiskGateDecision(
            approved=False, order_qty=0.0, original_qty=qty,
            size_multiplier=0.0, kill_switch=False,
            rules_passed=[], rules_failed=["RiskGateError"],
            reasons=[f"Risk gate error: {exc}"],
            risk_score=100.0,
        )


async def _evaluate(
    symbol: str,
    side: str,
    qty: float,
    price: Optional[float],
    strategy_id: Optional[str],
    venue_id: Optional[str],
) -> RiskGateDecision:
    from backend.services.guardian_bot.service import (
        is_kill_switch_active, is_strategy_killed, is_venue_killed,
        is_in_cooldown, cooldown_remaining_seconds,
    )
    from backend.engine.risk_rules import RiskRuleEngine
    from backend.models.risk import RiskContext
    import backend.services.portfolio.service as port_svc
    from backend.config.loader import get_risk_config

    # ── 1. Global kill switch ──────────────────────────────────
    if await is_kill_switch_active():
        return RiskGateDecision(
            approved=False, order_qty=0.0, original_qty=qty,
            size_multiplier=0.0, kill_switch=True,
            rules_passed=[], rules_failed=["KillSwitch"],
            reasons=["Global kill switch is active — all execution blocked"],
            risk_score=100.0,
        )

    # ── 1b. Post-kill-switch cooldown ────────────────────────
    if is_in_cooldown():
        remaining = cooldown_remaining_seconds()
        return RiskGateDecision(
            approved=False, order_qty=0.0, original_qty=qty,
            size_multiplier=0.0, kill_switch=False,
            rules_passed=[], rules_failed=["CooldownActive"],
            reasons=[f"Post-kill-switch cooldown active — {remaining}s remaining before trading resumes"],
            risk_score=100.0,
        )

    # ── 2. Scoped kill switches ────────────────────────────────
    if strategy_id and is_strategy_killed(strategy_id):
        return RiskGateDecision(
            approved=False, order_qty=0.0, original_qty=qty,
            size_multiplier=0.0, kill_switch=True,
            rules_passed=[], rules_failed=["StrategyKillSwitch"],
            reasons=[f"Strategy '{strategy_id}' is kill-switched"],
            risk_score=100.0,
        )
    if venue_id and is_venue_killed(venue_id):
        return RiskGateDecision(
            approved=False, order_qty=0.0, original_qty=qty,
            size_multiplier=0.0, kill_switch=True,
            rules_passed=[], rules_failed=["VenueKillSwitch"],
            reasons=[f"Venue '{venue_id}' is kill-switched"],
            risk_score=100.0,
        )

    # ── 3. Build live RiskContext ──────────────────────────────
    sym  = symbol.upper()
    cash = float(port_svc._cash)
    lots = port_svc._lots.get(sym, [])

    # Resolve mark price
    mark = price
    if mark is None:
        try:
            snap = await _get_price_fn(sym)
            mark = float(snap.price)
        except Exception:
            mark = 0.0

    # Per-symbol position value
    pos_value = sum(float(l.qty) * mark for l in lots)

    # Total portfolio exposure
    total_exp = 0.0
    for s, s_lots in port_svc._lots.items():
        if not s_lots:
            continue
        try:
            snap = await _get_price_fn(s)
            p = float(snap.price)
        except Exception:
            p = mark if s == sym else 0.0
        total_exp += sum(float(l.qty) * p for l in s_lots)

    # Daily realized PnL
    now = int(time.time())
    day_start = now - (now % 86400)
    daily_pnl = sum(
        float(t.realized_pnl) for t in port_svc._trades
        if t.realized_pnl is not None and t.executed_at >= day_start
    )

    # 24h volatility proxy
    vol_24h = 0.0
    try:
        snap = await _get_price_fn(sym)
        if hasattr(snap, "change24h") and snap.change24h is not None:
            vol_24h = abs(float(snap.change24h)) / 100.0
    except Exception:
        pass

    nav = cash + total_exp  # Net Asset Value

    # ── Drawdown-aware daily loss feedback ────────────────────
    # Pull live drawdown_pct from the guardian so the MaxDailyLossRule
    # scales down position sizes automatically as losses accumulate —
    # no manual trigger required.
    try:
        from backend.services.guardian_bot.service import _drawdown_pct as _gd_pct
        guardian_drawdown_loss = -nav * (_gd_pct / 100.0)
        # Use whichever is more conservative (larger negative number)
        daily_pnl = min(daily_pnl, guardian_drawdown_loss)
    except Exception:
        pass  # fallback: use trade-derived daily_pnl as-is

    ctx = RiskContext(
        symbol=sym, side=side.upper(), quantity=qty, price=mark,
        current_position_value=pos_value,
        current_total_exposure=total_exp,
        daily_pnl=daily_pnl,
        account_balance=nav,
        volatility_24h=vol_24h,
    )

    # ── 4. Run rule engine ─────────────────────────────────────
    cfg = get_risk_config()
    engine = RiskRuleEngine(
        max_position_pct=0.25,                        # 25% per symbol
        max_daily_loss_pct=cfg.max_drawdown_pct / 100,
        volatility_threshold=0.15,                    # 15% daily swing = block
        max_leverage=1.0,                             # no leverage in paper
        max_slippage_pct=0.01,
        max_total_exposure_pct=0.95,                  # keep 5% cash buffer
    )
    result = engine.evaluate(ctx)

    passed = [r.rule_name for r in result.rule_results if r.passed]
    failed = [r.rule_name for r in result.rule_results if not r.passed]
    reasons = [result.reason]

    adj_qty = qty * result.size_multiplier if result.approved else 0.0
    n = len(result.rule_results) or 1
    risk_score = min(len(failed) / n * 80 + vol_24h * 100, 100.0)

    return RiskGateDecision(
        approved=result.approved,
        order_qty=round(adj_qty, 8),
        original_qty=qty,
        size_multiplier=result.size_multiplier,
        kill_switch=False,
        rules_passed=passed,
        rules_failed=failed,
        reasons=reasons,
        risk_score=round(risk_score, 2),
        metadata={
            "account_balance":        round(nav, 2),
            "current_position_value": round(pos_value, 2),
            "total_exposure":         round(total_exp, 2),
            "daily_pnl":              round(daily_pnl, 2),
            "volatility_24h":         round(vol_24h, 4),
        },
    )
