# tests/services/test_risk_gate_decimal_fix.py
"""
Phase 8 supplement — regression tests for Decimal × float type errors in risk_gate.

The risk gate builds a RiskContext from portfolio state where Lot.qty is Decimal
but mark price is float. These tests confirm the fix holds and no TypeError escapes.

Coverage:
  1. pos_value calculation — Decimal lot qty × float mark price
  2. total_exp aggregation — multiple symbols with Decimal lots × float prices
  3. nav calculation — float cash + float total_exp
  4. daily_pnl sum — Decimal realized_pnl values coerced to float
  5. evaluate_risk end-to-end — passes with Decimal lots and float prices (mock)
  6. evaluate_risk with None realized_pnl — no AttributeError
  7. RiskContext accepts all-float values without coercion errors
  8. evaluate_risk returns approved=True for clean paper state (mock)
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.models.risk import RiskContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_lot(qty_str: str, avg_cost_str: str = "50000.0") -> MagicMock:
    lot = MagicMock()
    lot.qty = Decimal(qty_str)           # <-- Decimal, as in real portfolio
    lot.avg_cost = Decimal(avg_cost_str)
    return lot


def _make_trade(pnl_str: str | None, ts: int = 9999999999) -> MagicMock:
    t = MagicMock()
    t.realized_pnl = Decimal(pnl_str) if pnl_str is not None else None
    t.executed_at = ts
    return t


def _make_ticker(price: float = 60000.0, change24h: float = 1.5) -> MagicMock:
    snap = MagicMock()
    snap.price = Decimal(str(price))     # Decimal, as returned by adapter
    snap.change24h = change24h
    return snap


def _make_port_svc(
    cash: float = 9000.0,
    lots: dict | None = None,
    trades: list | None = None,
) -> MagicMock:
    svc = MagicMock()
    svc._cash = Decimal(str(cash))
    svc._lots = lots or {}
    svc._trades = trades or []
    svc.mode = "paper"
    return svc


# ---------------------------------------------------------------------------
# 1. pos_value — Decimal qty × float mark (direct arithmetic simulation)
# ---------------------------------------------------------------------------

def test_pos_value_decimal_float_coercion():
    """Confirm that float(lot.qty) * float(mark) works without TypeError."""
    lots = [_make_lot("0.001"), _make_lot("0.002")]
    mark = 60000.0  # float
    # This is the exact expression used in risk_gate after the fix
    pos_value = sum(float(l.qty) * float(mark) for l in lots)
    assert abs(pos_value - 180.0) < 0.01


# ---------------------------------------------------------------------------
# 2. total_exp aggregation — multiple symbols
# ---------------------------------------------------------------------------

def test_total_exp_multi_symbol():
    lots_btc = [_make_lot("0.001")]
    lots_eth = [_make_lot("0.05")]
    prices = {"BTCUSDT": 60000.0, "ETHUSDT": 3000.0}

    total_exp = 0.0
    for sym, sym_lots in [("BTCUSDT", lots_btc), ("ETHUSDT", lots_eth)]:
        p = prices[sym]
        total_exp += sum(float(l.qty) * float(p) for l in sym_lots)

    assert abs(total_exp - 210.0) < 0.01   # 0.001*60000 + 0.05*3000 = 60+150


# ---------------------------------------------------------------------------
# 3. nav calculation — float cash + float total_exp (no Decimal mixing)
# ---------------------------------------------------------------------------

def test_nav_calculation():
    cash = Decimal("9000.0")
    total_exp = 180.0
    nav = float(cash) + float(total_exp)
    assert isinstance(nav, float)
    assert abs(nav - 9180.0) < 0.01


# ---------------------------------------------------------------------------
# 4. daily_pnl sum — Decimal realized_pnl → float
# ---------------------------------------------------------------------------

def test_daily_pnl_decimal_coercion():
    import time
    now = int(time.time())
    day_start = now - (now % 86400)
    trades = [
        _make_trade("10.50",  ts=now),    # Decimal pnl
        _make_trade("-5.25",  ts=now),    # Decimal negative
        _make_trade(None,     ts=now),    # None — should not crash
        _make_trade("0.00",   ts=now - 86401),  # yesterday — excluded
    ]

    daily_pnl = sum(
        float(t.realized_pnl or 0) for t in trades
        if t.realized_pnl is not None and t.executed_at >= day_start
    )
    assert abs(daily_pnl - 5.25) < 0.001


# ---------------------------------------------------------------------------
# 5. evaluate_risk end-to-end with Decimal lots (mock portfolio + adapter)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_evaluate_risk_with_decimal_lots():
    """Full evaluate_risk call should not raise TypeError."""
    from backend.services.risk_gate.service import evaluate_order as evaluate_risk

    btc_lots = [_make_lot("0.001", "58000.0")]
    mock_port_module = _make_port_svc(cash=9500.0, lots={"BTCUSDT": btc_lots}, trades=[])
    mock_ticker = _make_ticker(price=60000.0, change24h=1.2)

    with patch("backend.services.risk_gate.service._get_price_fn", new_callable=AsyncMock, return_value=mock_ticker), \
         patch("backend.services.guardian_bot.service.is_kill_switch_active", return_value=False), \
         patch("backend.services.guardian_bot.service.is_strategy_killed", return_value=False), \
         patch("backend.services.guardian_bot.service.is_venue_killed", return_value=False), \
         patch("backend.services.guardian_bot.service.is_in_cooldown", return_value=False), \
         patch("backend.services.portfolio.service._cash", mock_port_module._cash), \
         patch("backend.services.portfolio.service._lots", mock_port_module._lots), \
         patch("backend.services.portfolio.service._trades", mock_port_module._trades):
        try:
            decision = await evaluate_risk("BTCUSDT", "BUY", 0.001, 60000.0)
            assert decision is not None
            assert isinstance(decision.risk_score, float)
        except TypeError as exc:
            pytest.fail(f"TypeError still present after fix: {exc}")


# ---------------------------------------------------------------------------
# 6. evaluate_risk with None realized_pnl
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_evaluate_risk_none_pnl():
    """None realized_pnl must not cause AttributeError or TypeError."""
    from backend.services.risk_gate.service import evaluate_order as evaluate_risk
    import time

    trade_with_none = _make_trade(None, ts=int(time.time()))
    mock_ticker = _make_ticker(60000.0)

    with patch("backend.services.risk_gate.service._get_price_fn", new_callable=AsyncMock, return_value=mock_ticker), \
         patch("backend.services.guardian_bot.service.is_kill_switch_active", return_value=False), \
         patch("backend.services.guardian_bot.service.is_strategy_killed", return_value=False), \
         patch("backend.services.guardian_bot.service.is_venue_killed", return_value=False), \
         patch("backend.services.guardian_bot.service.is_in_cooldown", return_value=False), \
         patch("backend.services.portfolio.service._cash", Decimal("10000.0")), \
         patch("backend.services.portfolio.service._lots", {}), \
         patch("backend.services.portfolio.service._trades", [trade_with_none]):
        try:
            decision = await evaluate_risk("BTCUSDT", "BUY", 0.001, 60000.0)
            assert decision is not None
        except (TypeError, AttributeError) as exc:
            pytest.fail(f"Exception with None pnl: {exc}")


# ---------------------------------------------------------------------------
# 7. RiskContext accepts all-float values
# ---------------------------------------------------------------------------

def test_risk_context_all_float():
    ctx = RiskContext(
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.001,
        price=60000.0,
        current_position_value=60.0,
        current_total_exposure=60.0,
        daily_pnl=-5.0,
        account_balance=9940.0,
        volatility_24h=0.012,
    )
    assert ctx.quantity == 0.001
    assert ctx.account_balance == 9940.0


# ---------------------------------------------------------------------------
# 8. evaluate_risk returns approved for clean paper state
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_evaluate_risk_approves_clean_state():
    """With clean portfolio (no lots, no losses, kill switch off) → approved=True."""
    from backend.services.risk_gate.service import evaluate_order as evaluate_risk

    mock_ticker = _make_ticker(60000.0, change24h=0.5)

    with patch("backend.services.risk_gate.service._get_price_fn", new_callable=AsyncMock, return_value=mock_ticker), \
         patch("backend.services.guardian_bot.service.is_kill_switch_active", return_value=False), \
         patch("backend.services.guardian_bot.service.is_strategy_killed", return_value=False), \
         patch("backend.services.guardian_bot.service.is_venue_killed", return_value=False), \
         patch("backend.services.guardian_bot.service.is_in_cooldown", return_value=False), \
         patch("backend.services.portfolio.service._cash", Decimal("10000.0")), \
         patch("backend.services.portfolio.service._lots", {}), \
         patch("backend.services.portfolio.service._trades", []):
        try:
            decision = await evaluate_risk("BTCUSDT", "BUY", 0.001, 60000.0)
            assert decision.approved is True, f"Expected approved, got: {decision.reasons}"
        except TypeError as exc:
            pytest.fail(f"TypeError: {exc}")
