"""
Tests for OMS idempotency.
"""
import pytest
from unittest.mock import MagicMock
from backend.contracts.schemas import ExecutionIntent, IntentAction
from backend.oms.manager import OrderManagementSystem

@pytest.fixture
def mock_supabase_client():
    """Fixture to create a mock Supabase client."""
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value = (None, 1)
    return client

@pytest.fixture
def oms(mock_supabase_client):
    """Fixture to create an OMS instance with a mock DB client."""
    return OrderManagementSystem(supabase_client=mock_supabase_client)

def test_oms_idempotency(oms: OrderManagementSystem):
    """
    Verify that submitting the same ExecutionIntent multiple times creates only one order.
    """
    intent = ExecutionIntent(
        intent_id="idempotent-intent-123",
        action=IntentAction.ENTER_LONG,
        symbol="BTC/USDT",
        size_fraction=0.1,
        reason="Test",
        risk_score=50.0,
    )

    # --- First Submission ---
    first_order = oms.submit_intent(intent)
    assert first_order is not None
    assert first_order.intent_id == "idempotent-intent-123"
    assert len(oms._orders) == 1

    # --- Subsequent Submissions ---
    for i in range(10):
        nth_order = oms.submit_intent(intent)
        assert nth_order is not None
        # Crucially, it should be the *same* order object
        assert nth_order.client_order_id == first_order.client_order_id
        # The number of orders in the OMS should NOT increase
        assert len(oms._orders) == 1

    # Verify that the database insert method was called exactly once
    oms._supabase.table('orders').insert.assert_called_once()
