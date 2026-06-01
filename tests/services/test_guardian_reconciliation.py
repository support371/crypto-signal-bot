# tests/services/test_guardian_reconciliation.py
"""
Reconciliation drift tests.

Verifies that the reconciliation service correctly:
  1. Reports clean when balance matches last known state.
  2. Detects balance drift when balance changes with no new trades.
  3. Does NOT flag drift when new trades explain the balance change.
  4. Handles P&L state unavailability gracefully (discrepancy=True).
  5. ReconciliationResult fields are correctly populated.
"""
from __future__ import annotations

import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_pnl(realized=0.0, unrealized=0.0, trades=5):
    pnl = MagicMock()
    pnl.total_realized_pnl = realized
    pnl.total_unrealized_pnl = unrealized
    pnl.trade_count = trades
    return pnl


def _make_lots(n_symbols=0, lots_per_symbol=0):
    """Return a dict like {symbol: [lot1, ...]}."""
    if n_symbols == 0:
        return {}
    return {f"SYM{i}": [MagicMock()] * lots_per_symbol for i in range(n_symbols)}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_clean_reconciliation():
    """No prior report → no drift flagged."""
    import backend.services.reconciliation.service as svc
    svc._last_report = None

    with (
        patch("backend.services.reconciliation.service.get_exchange_config",
              return_value=MagicMock(mode="paper")),
        patch("backend.engine.pnl.get_pnl_summary",
              new_callable=AsyncMock, return_value=_make_pnl(0.0, 0.0, 3)),
        patch("backend.engine.pnl.get_usdt_balance", return_value=10000.0),
        patch("backend.engine.pnl.get_all_lots", return_value={}),
    ):
        result = await svc.run_reconciliation()

    assert result.discrepancy_detected is False
    assert result.usdt_balance == 10000.0
    assert result.trade_count == 3


@pytest.mark.asyncio
async def test_drift_detected_no_new_trades():
    """Balance changes with same trade_count → drift flagged."""
    import backend.services.reconciliation.service as svc

    svc._last_report = {
        "usdt_balance": 10000.0,
        "total_realized_pnl": 0.0,
        "trade_count": 3,
        "created_at": int(time.time()) - 300,
    }

    with (
        patch("backend.services.reconciliation.service.get_exchange_config",
              return_value=MagicMock(mode="paper")),
        patch("backend.engine.pnl.get_pnl_summary",
              new_callable=AsyncMock, return_value=_make_pnl(0.0, 0.0, 3)),
        patch("backend.engine.pnl.get_usdt_balance", return_value=9500.0),  # drift!
        patch("backend.engine.pnl.get_all_lots", return_value={}),
    ):
        result = await svc.run_reconciliation()

    assert result.discrepancy_detected is True
    assert "drift" in result.discrepancy_detail.lower()
    assert "9500" in result.discrepancy_detail


@pytest.mark.asyncio
async def test_no_drift_when_new_trades_explain_change():
    """Balance changes AND trade_count increased → not a drift."""
    import backend.services.reconciliation.service as svc

    svc._last_report = {
        "usdt_balance": 10000.0,
        "total_realized_pnl": 0.0,
        "trade_count": 3,
        "created_at": int(time.time()) - 300,
    }

    with (
        patch("backend.services.reconciliation.service.get_exchange_config",
              return_value=MagicMock(mode="paper")),
        patch("backend.engine.pnl.get_pnl_summary",
              new_callable=AsyncMock, return_value=_make_pnl(50.0, 0.0, 5)),  # 2 new trades
        patch("backend.engine.pnl.get_usdt_balance", return_value=10050.0),
        patch("backend.engine.pnl.get_all_lots", return_value={}),
    ):
        result = await svc.run_reconciliation()

    assert result.discrepancy_detected is False


@pytest.mark.asyncio
async def test_drift_below_epsilon_ignored():
    """Sub-cent rounding differences (< 0.01) should NOT flag drift."""
    import backend.services.reconciliation.service as svc

    svc._last_report = {
        "usdt_balance": 10000.005,
        "total_realized_pnl": 0.0,
        "trade_count": 3,
        "created_at": int(time.time()) - 300,
    }

    with (
        patch("backend.services.reconciliation.service.get_exchange_config",
              return_value=MagicMock(mode="paper")),
        patch("backend.engine.pnl.get_pnl_summary",
              new_callable=AsyncMock, return_value=_make_pnl(0.0, 0.0, 3)),
        patch("backend.engine.pnl.get_usdt_balance", return_value=10000.008),  # < 0.01 drift
        patch("backend.engine.pnl.get_all_lots", return_value={}),
    ):
        result = await svc.run_reconciliation()

    assert result.discrepancy_detected is False


@pytest.mark.asyncio
async def test_pnl_unavailable_flags_discrepancy():
    """When P&L state throws, reconciliation must return discrepancy=True."""
    import backend.services.reconciliation.service as svc
    svc._last_report = None

    with (
        patch("backend.services.reconciliation.service.get_exchange_config",
              return_value=MagicMock(mode="paper")),
        patch("backend.engine.pnl.get_pnl_summary",
              new_callable=AsyncMock, side_effect=RuntimeError("DB unavailable")),
        patch("backend.engine.pnl.get_usdt_balance", side_effect=RuntimeError("DB unavailable")),
        patch("backend.engine.pnl.get_all_lots", side_effect=RuntimeError("DB unavailable")),
    ):
        result = await svc.run_reconciliation()

    assert result.discrepancy_detected is True
    assert result.discrepancy_detail is not None


@pytest.mark.asyncio
async def test_result_fields_populated():
    """ReconciliationResult fields match what was passed in."""
    import backend.services.reconciliation.service as svc
    svc._last_report = None

    with (
        patch("backend.services.reconciliation.service.get_exchange_config",
              return_value=MagicMock(mode="paper")),
        patch("backend.engine.pnl.get_pnl_summary",
              new_callable=AsyncMock, return_value=_make_pnl(100.0, 50.0, 7)),
        patch("backend.engine.pnl.get_usdt_balance", return_value=10100.0),
        patch("backend.engine.pnl.get_all_lots", return_value=_make_lots(2, 3)),
    ):
        result = await svc.run_reconciliation()

    assert result.mode == "paper"
    assert result.usdt_balance == 10100.0
    assert result.total_realized_pnl == 100.0
    assert result.total_unrealized_pnl == 50.0
    assert result.open_lots_count == 6  # 2 symbols * 3 lots
    assert result.trade_count == 7
    assert result.created_at > 0
