"""
Unit tests for the Order Management System (OMS).
"""
import pytest
from unittest.mock import MagicMock
from backend.contracts.schemas import ExecutionIntent
from backend.oms.manager import OrderManagementSystem

@pytest.fixture
def oms() -> OrderManagementSystem:
    return OrderManagementSystem(supabase_client=MagicMock())

@pytest.fixture
def sample_intent() -> ExecutionIntent:
    return ExecutionIntent(
        intent_id="unique_intent_123",
        action="ENTER_LONG",
        symbol="BTC/USDT",
        size_fraction=0.1,
        reason="Test",
        risk_score=50
    )

@pytest.fixture
def hold_intent() -> ExecutionIntent:
    return ExecutionIntent(
        intent_id="hold_intent_456",
        action="HOLD",
        symbol="BTC/USDT",
        size_fraction=0.0,
        reason="Test",
        risk_score=50
    )

def test_idempotency_same_intent_submitted_multiple_times(oms, sample_intent):
    order1 = oms.submit_intent(sample_intent)
    assert order1 is not None
    assert order1.status == "NEW"
    assert len(oms.orders) == 1
    assert len(oms.idempotency_store) == 1

    order2 = oms.submit_intent(sample_intent)
    assert order2 is order1
    assert len(oms.orders) == 1
    assert len(oms.idempotency_store) == 1

def test_idempotency_hold_intent(oms, hold_intent):
    order1 = oms.submit_intent(hold_intent)
    assert order1 is not None
    assert len(oms.orders) == 0
    assert len(oms.idempotency_store) == 1

    order2 = oms.submit_intent(hold_intent)
    assert order2 is order1
    assert len(oms.orders) == 0
    assert len(oms.idempotency_store) == 1

def test_legal_state_transitions(oms, sample_intent):
    order = oms.submit_intent(sample_intent)

    oms.update_order_status(order.order_id, "SENT")
    assert order.status == "SENT"

    oms.update_order_status(order.order_id, "ACKED")
    assert order.status == "ACKED"

    oms.update_order_status(order.order_id, "PARTIAL")
    assert order.status == "PARTIAL"

    oms.update_order_status(order.order_id, "FILLED")
    assert order.status == "FILLED"

def test_illegal_state_transitions(oms, sample_intent):
    order = oms.submit_intent(sample_intent)

    oms.update_order_status(order.order_id, "SENT")
    oms.update_order_status(order.order_id, "ACKED")

    with pytest.raises(ValueError, match="Illegal state transition from ACKED to NEW"):
        oms.update_order_status(order.order_id, "NEW")

    oms.update_order_status(order.order_id, "FILLED")

    with pytest.raises(ValueError, match="Illegal state transition from FILLED to CANCELED"):
        oms.update_order_status(order.order_id, "CANCELED")

def test_cancel_from_valid_states(oms, sample_intent):
    order_new = oms.submit_intent(sample_intent)
    oms.update_order_status(order_new.order_id, "CANCELED")
    assert order_new.status == "CANCELED"

    intent2 = sample_intent.model_copy(update={"intent_id": "intent_2"})
    order_sent = oms.submit_intent(intent2)
    oms.update_order_status(order_sent.order_id, "SENT")
    oms.update_order_status(order_sent.order_id, "CANCELED")
    assert order_sent.status == "CANCELED"

    intent3 = sample_intent.model_copy(update={"intent_id": "intent_3"})
    order_acked = oms.submit_intent(intent3)
    oms.update_order_status(order_acked.order_id, "SENT")
    oms.update_order_status(order_acked.order_id, "ACKED")
    oms.update_order_status(order_acked.order_id, "CANCELED")
    assert order_acked.status == "CANCELED"
