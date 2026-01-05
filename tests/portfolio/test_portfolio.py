"""
Unit tests for the Portfolio Manager.
"""
import pytest
from unittest.mock import MagicMock
from backend.contracts.schemas import ExecutionReport
from backend.portfolio.manager import PortfolioManager

@pytest.fixture
def portfolio_manager() -> PortfolioManager:
    return PortfolioManager(initial_balance=10000.0, supabase_client=MagicMock())

def test_buy_fill_updates_state(portfolio_manager):
    fill = ExecutionReport(venue_order_id="v1", fill_id="f1", client_order_id="c1", symbol="BTC/USDT", side="BUY", quantity=0.1, price=50000, timestamp=0)

    portfolio_manager.process_fill(fill)

    assert portfolio_manager.state.positions["BTC/USDT"] == 0.1
    assert portfolio_manager.state.balances["USDT"] == 5000.0

def test_sell_fill_updates_state(portfolio_manager):
    # First, a buy to establish a position
    buy_fill = ExecutionReport(venue_order_id="v1", fill_id="f1", client_order_id="c1", symbol="BTC/USDT", side="BUY", quantity=0.2, price=50000, timestamp=0)
    portfolio_manager.process_fill(buy_fill)

    # Now, a sell
    sell_fill = ExecutionReport(venue_order_id="v2", fill_id="f2", client_order_id="c2", symbol="BTC/USDT", side="SELL", quantity=0.1, price=52000, timestamp=1)
    portfolio_manager.process_fill(sell_fill)

    assert portfolio_manager.state.positions["BTC/USDT"] == 0.1

def test_duplicate_fills_are_ignored(portfolio_manager):
    fill = ExecutionReport(venue_order_id="v1", fill_id="f1", client_order_id="c1", symbol="BTC/USDT", side="BUY", quantity=0.1, price=50000, timestamp=0)

    portfolio_manager.process_fill(fill)
    portfolio_manager.process_fill(fill) # Process the same fill again

    assert portfolio_manager.state.positions["BTC/USDT"] == 0.1
    assert portfolio_manager.state.balances["USDT"] == 5000.0
