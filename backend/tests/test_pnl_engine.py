"""Tests for the P&L engine (backend/engine/pnl.py)."""

from decimal import Decimal

from backend.engine.pnl import (
    process_fill,
    reset_pnl_state,
    get_usdt_balance,
    get_all_lots,
    get_realized_trades,
)


class TestProcessFill:
    def setup_method(self):
        reset_pnl_state(Decimal("10000"))

    def test_buy_deducts_balance(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        assert get_usdt_balance() == Decimal("10000") - Decimal("0.1") * Decimal("50000")

    def test_buy_adds_lot(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        lots = get_all_lots()
        assert "BTC/USDT" in lots
        assert len(lots["BTC/USDT"]) == 1
        assert lots["BTC/USDT"][0].quantity == Decimal("0.1")

    def test_buy_returns_none(self):
        result = process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        assert result is None

    def test_sell_returns_realized_trade(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        trade = process_fill("o2", "BTC/USDT", "SELL", Decimal("0.1"), Decimal("55000"), 2000)
        assert trade is not None
        assert trade.symbol == "BTC/USDT"
        assert trade.realized_pnl > 0

    def test_sell_fifo_order(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.05"), Decimal("50000"), 1000)
        process_fill("o2", "BTC/USDT", "BUY", Decimal("0.05"), Decimal("60000"), 1500)
        trade = process_fill("o3", "BTC/USDT", "SELL", Decimal("0.05"), Decimal("55000"), 2000)
        assert trade is not None
        assert trade.open_price == Decimal("50000")

    def test_sell_adds_proceeds_to_balance(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        balance_after_buy = get_usdt_balance()
        process_fill("o2", "BTC/USDT", "SELL", Decimal("0.1"), Decimal("55000"), 2000)
        assert get_usdt_balance() > balance_after_buy

    def test_sell_removes_lots(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        process_fill("o2", "BTC/USDT", "SELL", Decimal("0.1"), Decimal("55000"), 2000)
        lots = get_all_lots()
        assert len(lots.get("BTC/USDT", [])) == 0

    def test_partial_sell(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        trade = process_fill("o2", "BTC/USDT", "SELL", Decimal("0.05"), Decimal("55000"), 2000)
        assert trade is not None
        assert trade.quantity == Decimal("0.05")
        lots = get_all_lots()
        assert lots["BTC/USDT"][0].quantity == Decimal("0.05")

    def test_loss_trade(self):
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        trade = process_fill("o2", "BTC/USDT", "SELL", Decimal("0.1"), Decimal("45000"), 2000)
        assert trade.realized_pnl < 0


class TestResetState:
    def test_reset_clears_lots(self):
        reset_pnl_state()
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        reset_pnl_state()
        assert get_all_lots() == {}

    def test_reset_clears_trades(self):
        reset_pnl_state()
        process_fill("o1", "BTC/USDT", "BUY", Decimal("0.1"), Decimal("50000"), 1000)
        process_fill("o2", "BTC/USDT", "SELL", Decimal("0.1"), Decimal("55000"), 2000)
        reset_pnl_state()
        assert get_realized_trades() == []

    def test_reset_restores_balance(self):
        reset_pnl_state(Decimal("20000"))
        assert get_usdt_balance() == Decimal("20000")
