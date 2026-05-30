"""
Tests for risk gate service and guardian integration — Phase 3.

Patches:
  - _get_price_fn  at backend.services.risk_gate.service level
  - is_kill_switch_active at backend.services.guardian_bot.service level
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

import backend.services.guardian_bot.service as guardian_svc
import backend.services.portfolio.service as port_svc
from backend.services.portfolio.service import reset_portfolio, STARTING_CASH
from backend.services.risk_gate.service import evaluate_order


# ── helpers ───────────────────────────────────────────────────────

def _price_mock(value: float):
    snap = AsyncMock()
    snap.price = Decimal(str(value))
    snap.change24h = 2.0
    return AsyncMock(return_value=snap)


def _ks_off():
    return patch("backend.services.guardian_bot.service.is_kill_switch_active",
                 AsyncMock(return_value=False))


def _ks_on():
    return patch("backend.services.guardian_bot.service.is_kill_switch_active",
                 AsyncMock(return_value=True))


def run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ── fixtures ──────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset():
    reset_portfolio(STARTING_CASH)
    guardian_svc._kill_switch_active = False
    guardian_svc._kill_switch_reason = None
    guardian_svc._api_error_count    = 0
    guardian_svc._failed_order_count = 0
    guardian_svc._strategy_kill_switches.clear()
    guardian_svc._venue_kill_switches.clear()
    yield
    reset_portfolio(STARTING_CASH)
    guardian_svc._kill_switch_active = False
    guardian_svc._strategy_kill_switches.clear()
    guardian_svc._venue_kill_switches.clear()


# ── Kill switch ───────────────────────────────────────────────────

class TestKillSwitch:
    def test_global_ks_blocks(self):
        guardian_svc._kill_switch_active = True
        with patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            d = run(evaluate_order("BTCUSDT", "BUY", 0.1))
        assert not d.approved
        assert d.kill_switch
        assert "KillSwitch" in d.rules_failed

    def test_no_ks_passes_check(self):
        guardian_svc._kill_switch_active = False
        with _ks_off(), patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            d = run(evaluate_order("BTCUSDT", "BUY", 0.001))
        assert not d.kill_switch

    def test_strategy_ks_blocks(self):
        guardian_svc._strategy_kill_switches.add("trend_follow")
        with patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            d = run(evaluate_order("BTCUSDT", "BUY", 0.01, strategy_id="trend_follow"))
        assert not d.approved and d.kill_switch
        assert "StrategyKillSwitch" in d.rules_failed

    def test_venue_ks_blocks(self):
        guardian_svc._venue_kill_switches.add("binance")
        with patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            d = run(evaluate_order("BTCUSDT", "BUY", 0.01, venue_id="binance"))
        assert not d.approved and d.kill_switch
        assert "VenueKillSwitch" in d.rules_failed

    def test_ks_order_qty_is_zero(self):
        guardian_svc._kill_switch_active = True
        with patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            d = run(evaluate_order("BTCUSDT", "BUY", 0.1))
        assert d.order_qty == 0.0

    def test_ks_risk_score_is_100(self):
        guardian_svc._kill_switch_active = True
        with patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            d = run(evaluate_order("BTCUSDT", "BUY", 0.1))
        assert d.risk_score == 100.0


# ── Rule engine ───────────────────────────────────────────────────

class TestRuleEngine:
    def _eval(self, qty, price=50000, side="BUY"):
        with _ks_off(), patch("backend.services.risk_gate.service._get_price_fn", _price_mock(price)):
            return run(evaluate_order("BTCUSDT", side, qty, price=price))

    def test_tiny_order_approved(self):
        # 0.001 BTC at $50k = $50 against $10k account — well within limits
        d = self._eval(qty=0.001)
        assert d.approved

    def test_oversized_blocked(self):
        # 1 BTC at $50k = $50k against $10k account — exceeds max_position_pct
        d = self._eval(qty=1.0)
        assert not d.approved

    def test_approved_qty_positive(self):
        d = self._eval(qty=0.001)
        assert d.order_qty > 0

    def test_blocked_qty_zero(self):
        d = self._eval(qty=1.0)
        assert d.order_qty == 0.0

    def test_risk_score_in_range(self):
        d = self._eval(qty=0.001)
        assert 0.0 <= d.risk_score <= 100.0

    def test_decision_has_metadata(self):
        d = self._eval(qty=0.001)
        for k in ("account_balance", "total_exposure", "daily_pnl"):
            assert k in d.metadata

    def test_reasons_populated(self):
        d = self._eval(qty=1.0)
        assert len(d.reasons) > 0

    def test_sell_passes_position_rules(self):
        # SELL always passes MaxPosition / Leverage (reduces exposure)
        d = self._eval(qty=0.001, side="SELL")
        assert "MaxPosition" in d.rules_passed

    def test_size_multiplier_one_on_small_order(self):
        d = self._eval(qty=0.001)
        if d.approved:
            assert 0 < d.size_multiplier <= 1.0


# ── Portfolio + risk gate end-to-end ─────────────────────────────

class TestPortfolioRiskIntegration:
    def test_oversized_order_cancelled(self):
        """1 BTC at $50k >> account balance → risk gate cancels it."""
        with _ks_off(), patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            with patch("backend.services.portfolio.service.get_price", _price_mock(50000)):
                order = run(port_svc.submit_order("BTCUSDT", "BUY", "MARKET", 1.0))
        assert order.status == "CANCELLED"

    def test_kill_switch_cancels_via_portfolio(self):
        guardian_svc._kill_switch_active = True
        with patch("backend.services.portfolio.service.get_price", _price_mock(50000)):
            order = run(port_svc.submit_order("BTCUSDT", "BUY", "MARKET", 0.001))
        assert order.status == "CANCELLED"

    def test_small_order_fills_via_portfolio(self):
        """0.001 BTC passes risk gate and fills."""
        with _ks_off(), patch("backend.services.risk_gate.service._get_price_fn", _price_mock(50000)):
            with patch("backend.services.portfolio.service.get_price", _price_mock(50000)):
                order = run(port_svc.submit_order("BTCUSDT", "BUY", "MARKET", 0.001))
        assert order.status == "FILLED"


# ── Guardian counter / scope management ──────────────────────────

class TestGuardianManagement:
    def test_reset_counters(self):
        guardian_svc._api_error_count    = 9
        guardian_svc._failed_order_count = 4
        guardian_svc.reset_counters()
        assert guardian_svc._api_error_count    == 0
        assert guardian_svc._failed_order_count == 0

    def test_strategy_scope_roundtrip(self):
        async def _t():
            await guardian_svc.kill_strategy("ema_cross")
            assert guardian_svc.is_strategy_killed("ema_cross")
            await guardian_svc.revive_strategy("ema_cross")
            assert not guardian_svc.is_strategy_killed("ema_cross")
        run(_t())

    def test_venue_scope_roundtrip(self):
        async def _t():
            await guardian_svc.kill_venue("binance")
            assert guardian_svc.is_venue_killed("binance")
            await guardian_svc.revive_venue("binance")
            assert not guardian_svc.is_venue_killed("binance")
        run(_t())

    def test_drawdown_triggers_ks_at_threshold(self):
        """Drawdown >= configured threshold → kill switch activates."""
        from backend.config.loader import get_risk_config
        threshold = get_risk_config().max_drawdown_pct

        async def _t():
            guardian_svc._kill_switch_active = False
            await guardian_svc.update_drawdown(threshold)   # exactly at threshold
            return guardian_svc._kill_switch_active
        assert run(_t()) is True

    def test_drawdown_below_threshold_safe(self):
        async def _t():
            guardian_svc._kill_switch_active = False
            await guardian_svc.update_drawdown(0.1)   # 0.1% — always safe
            return guardian_svc._kill_switch_active
        assert run(_t()) is False
