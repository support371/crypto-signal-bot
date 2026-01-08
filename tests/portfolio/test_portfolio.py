"""
Tests for Portfolio Manager fill deduplication.
"""
import pytest
from unittest.mock import MagicMock
from backend.contracts.schemas import ExecutionReport, OrderSide
from backend.portfolio.manager import PortfolioManager

@pytest.fixture
def mock_supabase_client():
    """Fixture to create a mock Supabase client."""
    client = MagicMock()
    # Assume the upsert works
    client.table.return_value.upsert.return_value.execute.return_value = (None, 1)
    return client

@pytest.fixture
def portfolio_manager(mock_supabase_client):
    """Fixture to create a PortfolioManager instance with a mock DB client."""
    return PortfolioManager(initial_balance=10000.0, supabase_client=mock_supabase_client)

def test_portfolio_fill_deduplication(portfolio_manager: PortfolioManager):
    """
    Verify that processing the same ExecutionReport multiple times does not
    result in double-counting the position or cash.
    """
    report = ExecutionReport(
        venue_order_id="venue-1",
        fill_id="unique-fill-abc", # The key for deduplication
        client_order_id="client-1",
        symbol="BTC/USDT",
        side=OrderSide.BUY,
        quantity=0.1,
        price=30000.0,
        timestamp=1234567890
    )

    initial_nav = portfolio_manager.state.nav

    # --- First Process ---
    portfolio_manager.process_execution_report(report)

    # State should be updated
    assert portfolio_manager.state.balances["BTC"] == 0.1
    assert portfolio_manager.state.balances["USDT"] == 10000.0 - (0.1 * 30000.0)

    # --- Subsequent Processes ---
    for _ in range(10):
        portfolio_manager.process_execution_report(report)

    # The state should remain exactly the same as after the first process
    assert portfolio_manager.state.balances["BTC"] == 0.1
    assert portfolio_manager.state.balances["USDT"] == 7000.0

    # Verify that the database save method was called exactly once for this fill
    portfolio_manager._supabase.table('portfolio_state').upsert.assert_called_once()
