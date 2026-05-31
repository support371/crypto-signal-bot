"""Regression tests for paper trading fill simulation."""

import pytest

from backend.logic.paper_trading import PaperPortfolio, simulate_fill
from backend.models.execution_intent import ExecutionIntent, IntentStatus, OrderType, Side


def test_buy_fill_debits_quote_and_credits_base():
    portfolio = PaperPortfolio(balances={"USDT": 1000.0})
    intent = ExecutionIntent(
        symbol="BTCUSDT",
        side=Side.BUY,
        order_type=OrderType.MARKET,
        quantity=0.01,
    )

    filled = simulate_fill(intent, portfolio, market_price=10000.0)

    assert filled.status == IntentStatus.FILLED
    assert filled.fill_quantity == pytest.approx(0.01)
    assert filled.fill_price is not None
    assert 10000.0 < filled.fill_price < 10005.1
    assert portfolio.get_balance("BTC") == pytest.approx(0.01)
    assert portfolio.get_balance("USDT") == pytest.approx(1000.0 - filled.fill_price * 0.01)
    assert filled in portfolio.filled_orders


def test_buy_fill_fails_when_quote_balance_is_insufficient():
    portfolio = PaperPortfolio(balances={"USDT": 10.0})
    intent = ExecutionIntent(
        symbol="BTCUSDT",
        side=Side.BUY,
        order_type=OrderType.MARKET,
        quantity=1.0,
    )

    result = simulate_fill(intent, portfolio, market_price=10000.0)

    assert result.status == IntentStatus.FAILED
    assert "Insufficient USDT balance" in result.notes
    assert portfolio.get_balance("USDT") == pytest.approx(10.0)
    assert portfolio.get_balance("BTC") == pytest.approx(0.0)
    assert result not in portfolio.filled_orders


def test_sell_fill_debits_base_and_credits_quote():
    portfolio = PaperPortfolio(balances={"BTC": 0.25, "USDT": 100.0})
    intent = ExecutionIntent(
        symbol="BTCUSDT",
        side=Side.SELL,
        order_type=OrderType.MARKET,
        quantity=0.1,
    )

    filled = simulate_fill(intent, portfolio, market_price=20000.0)

    assert filled.status == IntentStatus.FILLED
    assert filled.fill_quantity == pytest.approx(0.1)
    assert filled.fill_price is not None
    assert 19989.9 < filled.fill_price < 20000.0
    assert portfolio.get_balance("BTC") == pytest.approx(0.15)
    assert portfolio.get_balance("USDT") == pytest.approx(100.0 + filled.fill_price * 0.1)
    assert filled in portfolio.filled_orders


def test_sell_fill_removes_base_balance_when_sold_to_zero():
    portfolio = PaperPortfolio(balances={"BTC": 0.1, "USDT": 100.0})
    intent = ExecutionIntent(
        symbol="BTCUSDT",
        side=Side.SELL,
        order_type=OrderType.MARKET,
        quantity=0.1,
    )

    filled = simulate_fill(intent, portfolio, market_price=20000.0)

    assert filled.status == IntentStatus.FILLED
    assert "BTC" not in portfolio.balances
    assert portfolio.get_balance("BTC") == pytest.approx(0.0)
    assert portfolio.get_balance("USDT") > 100.0


def test_sell_fill_fails_when_base_balance_is_insufficient():
    portfolio = PaperPortfolio(balances={"BTC": 0.01, "USDT": 100.0})
    intent = ExecutionIntent(
        symbol="BTCUSDT",
        side=Side.SELL,
        order_type=OrderType.MARKET,
        quantity=0.1,
    )

    result = simulate_fill(intent, portfolio, market_price=20000.0)

    assert result.status == IntentStatus.FAILED
    assert "Insufficient BTC balance" in result.notes
    assert portfolio.get_balance("BTC") == pytest.approx(0.01)
    assert portfolio.get_balance("USDT") == pytest.approx(100.0)
    assert result not in portfolio.filled_orders


def test_filled_order_is_removed_from_open_orders():
    portfolio = PaperPortfolio(balances={"USDT": 1000.0})
    intent = ExecutionIntent(
        symbol="ETHUSDT",
        side=Side.BUY,
        order_type=OrderType.MARKET,
        quantity=0.1,
    )
    portfolio.open_orders.append(intent)

    filled = simulate_fill(intent, portfolio, market_price=1000.0)

    assert filled.status == IntentStatus.FILLED
    assert intent not in portfolio.open_orders
    assert intent in portfolio.filled_orders
