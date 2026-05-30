"""
Tests for Portfolio & PnL engine.
Uses unittest.mock to avoid live price calls.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

import backend.services.portfolio.service as svc
from backend.services.portfolio.service import (
    STARTING_CASH,
    reset_portfolio,
    get_portfolio_summary,
    get_orders,
    get_trades,
    submit_order,
    _compute_equity,
    _fifo_close,
    _cash, _lots, _orders, _trades,
)

# ── helpers ───────────────────────────────────────────────────────

def _mock_price(value: float):
    """Patch get_price to return a fake snapshot."""
    snap = AsyncMock()
    snap.price = Decimal(str(value))
    return AsyncMock(return_value=snap)


def run(coro):
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Inside pytest-asyncio — use a new loop
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ── fixtures ──────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def fresh_portfolio():
    """Reset in-process state before every test."""
    reset_portfolio(STARTING_CASH)
    yield
    reset_portfolio(STARTING_CASH)


# ── MARKET BUY ────────────────────────────────────────────────────

class TestMarketBuy:
    def test_order_status_filled(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            order = run(submit_order("BTCUSDT", "BUY", "MARKET", 0.1))
        assert order.status == "FILLED"

    def test_cash_deducted(self):
        price = 50000.0
        qty   = 0.1
        with patch("backend.services.portfolio.service.get_price", _mock_price(price)):
            run(submit_order("BTCUSDT", "BUY", "MARKET", qty))
        cost      = Decimal(str(price)) * Decimal(str(qty))
        fee       = cost * svc.FEE_RATE
        expected  = STARTING_CASH - cost - fee
        assert abs(svc._cash - expected) < Decimal("0.01")

    def test_lot_created(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            run(submit_order("BTCUSDT", "BUY", "MARKET", 0.1))
        assert len(svc._lots["BTCUSDT"]) == 1
        assert svc._lots["BTCUSDT"][0].qty == Decimal("0.1")

    def test_insufficient_cash_cancels(self):
        # Try to buy 1 BTC at 50000 but we only have 10000 starting cash
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            order = run(submit_order("BTCUSDT", "BUY", "MARKET", 1.0))
        assert order.status == "CANCELLED"
        assert svc._cash == STARTING_CASH    # cash unchanged


# ── MARKET SELL ───────────────────────────────────────────────────

class TestMarketSell:
    def test_sell_fills_and_closes_position(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            run(submit_order("BTCUSDT", "BUY", "MARKET", 0.1))
        with patch("backend.services.portfolio.service.get_price", _mock_price(52000)):
            run(submit_order("BTCUSDT", "SELL", "MARKET", 0.1))
        assert len(svc._lots.get("BTCUSDT", [])) == 0

    def test_profitable_sell_increases_cash(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            run(submit_order("BTCUSDT", "BUY", "MARKET", 0.1))
        cash_after_buy = svc._cash
        with patch("backend.services.portfolio.service.get_price", _mock_price(55000)):
            run(submit_order("BTCUSDT", "SELL", "MARKET", 0.1))
        assert svc._cash > cash_after_buy

    def test_realized_pnl_positive_on_profit(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(40000)):
            run(submit_order("BTCUSDT", "BUY", "MARKET", 0.1))
        with patch("backend.services.portfolio.service.get_price", _mock_price(45000)):
            run(submit_order("BTCUSDT", "SELL", "MARKET", 0.1))
        sell_trade = [t for t in svc._trades if t.side == "SELL"][-1]
        assert sell_trade.realized_pnl > 0

    def test_realized_pnl_negative_on_loss(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            run(submit_order("BTCUSDT", "BUY", "MARKET", 0.1))
        with patch("backend.services.portfolio.service.get_price", _mock_price(45000)):
            run(submit_order("BTCUSDT", "SELL", "MARKET", 0.1))
        sell_trade = [t for t in svc._trades if t.side == "SELL"][-1]
        assert sell_trade.realized_pnl < 0

    def test_sell_without_position_cancels(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            order = run(submit_order("BTCUSDT", "SELL", "MARKET", 0.1))
        assert order.status == "CANCELLED"


# ── LIMIT ORDER ───────────────────────────────────────────────────

class TestLimitOrder:
    def test_limit_buy_stays_pending(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            order = run(submit_order("BTCUSDT", "BUY", "LIMIT", 0.1, price=45000))
        assert order.status == "PENDING"

    def test_limit_order_stored(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
            order = run(submit_order("BTCUSDT", "BUY", "LIMIT", 0.1, price=45000))
        assert order.id in svc._orders
        assert svc._orders[order.id].order_type == "LIMIT"


# ── FIFO ──────────────────────────────────────────────────────────

class TestFIFO:
    def test_fifo_single_lot(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(100)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 1.0))
        avg_cost, pnl = _fifo_close("ETHUSD", Decimal("1.0"), Decimal("120"))
        assert avg_cost == pytest.approx(Decimal("100"), abs=Decimal("1"))
        assert pnl == pytest.approx(Decimal("20"), abs=Decimal("1"))

    def test_fifo_partial_lot(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(100)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 2.0))
        _fifo_close("ETHUSD", Decimal("1.0"), Decimal("110"))
        # 1 lot should remain
        assert sum(l.qty for l in svc._lots["ETHUSD"]) == pytest.approx(1.0, abs=0.001)

    def test_fifo_multi_lot_order(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(100)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 1.0))
        with patch("backend.services.portfolio.service.get_price", _mock_price(200)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 1.0))
        # Selling 1 unit should consume first lot at cost=100
        avg_cost, _ = _fifo_close("ETHUSD", Decimal("1.0"), Decimal("150"))
        assert avg_cost == pytest.approx(Decimal("100"), abs=Decimal("2"))


# ── Equity & Drawdown ─────────────────────────────────────────────

class TestEquity:
    def test_equity_equals_cash_when_no_positions(self):
        async def _check():
            eq = await _compute_equity()
            return eq
        eq = run(_check())
        assert eq == pytest.approx(STARTING_CASH, abs=Decimal("0.01"))

    def test_equity_increases_on_mark_up(self):
        # Buy at 100, mark moves to 200 — unrealized gain should exceed fee paid
        with patch("backend.services.portfolio.service.get_price", _mock_price(100)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 1.0))
        cash_after_buy = float(svc._cash)

        async def _check():
            with patch("backend.services.portfolio.service.get_price", _mock_price(200)):
                return await _compute_equity()

        eq = run(_check())
        # equity should be cash + unrealized_gain = cash_after_buy + (200-100)*1
        assert float(eq) > cash_after_buy + 90    # 100 gain minus small fee

    def test_drawdown_calculated(self):
        async def _check():
            with patch("backend.services.portfolio.service.get_price", _mock_price(10000)):
                summary = await get_portfolio_summary()
            return summary
        summary = run(_check())
        assert "drawdown_pct" in summary
        assert summary["drawdown_pct"] >= 0


# ── Portfolio summary ─────────────────────────────────────────────

class TestPortfolioSummary:
    def test_summary_has_required_fields(self):
        async def _check():
            with patch("backend.services.portfolio.service.get_price", _mock_price(50000)):
                return await get_portfolio_summary()
        s = run(_check())
        for k in ["cash_balance", "equity", "max_equity", "drawdown_pct",
                   "total_realized_pnl", "total_unrealized_pnl",
                   "trade_count", "win_rate_pct", "open_positions"]:
            assert k in s

    def test_win_rate_100_on_all_wins(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(100)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 1.0))
        with patch("backend.services.portfolio.service.get_price", _mock_price(200)):
            run(submit_order("ETHUSD", "SELL", "MARKET", 1.0))

        async def _check():
            with patch("backend.services.portfolio.service.get_price", _mock_price(200)):
                return await get_portfolio_summary()
        s = run(_check())
        assert s["win_rate_pct"] == 100.0

    def test_trade_count_increments(self):
        with patch("backend.services.portfolio.service.get_price", _mock_price(100)):
            run(submit_order("ETHUSD", "BUY", "MARKET", 1.0))
        with patch("backend.services.portfolio.service.get_price", _mock_price(110)):
            run(submit_order("ETHUSD", "SELL", "MARKET", 1.0))

        async def _check():
            with patch("backend.services.portfolio.service.get_price", _mock_price(110)):
                return await get_portfolio_summary()
        s = run(_check())
        assert s["trade_count"] == 1   # 1 SELL = 1 closed trade
