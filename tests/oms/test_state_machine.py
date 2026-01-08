"""
Tests for the Order State Machine.
"""
import pytest
from backend.contracts.schemas import OrderStatus
from backend.oms.state_machine import assert_valid_transition, IllegalStateTransitionError

def test_valid_transitions():
    """Verify that all legally defined state transitions are allowed."""
    # From NEW
    assert_valid_transition(OrderStatus.NEW, OrderStatus.SENT)
    assert_valid_transition(OrderStatus.NEW, OrderStatus.CANCELED)

    # From SENT
    assert_valid_transition(OrderStatus.SENT, OrderStatus.ACKED)
    assert_valid_transition(OrderStatus.SENT, OrderStatus.FILLED)
    assert_valid_transition(OrderStatus.SENT, OrderStatus.CANCELED)

    # From ACKED
    assert_valid_transition(OrderStatus.ACKED, OrderStatus.PARTIAL)
    assert_valid_transition(OrderStatus.ACKED, OrderStatus.FILLED)
    assert_valid_transition(OrderStatus.ACKED, OrderStatus.CANCELED)

    # From PARTIAL
    assert_valid_transition(OrderStatus.PARTIAL, OrderStatus.FILLED)
    assert_valid_transition(OrderStatus.PARTIAL, OrderStatus.CANCELED)

def test_invalid_transitions():
    """Verify that illegal state transitions raise an exception."""
    # Cannot jump from NEW to FILLED
    with pytest.raises(IllegalStateTransitionError):
        assert_valid_transition(OrderStatus.NEW, OrderStatus.FILLED)

    # Cannot go backwards from ACKED to SENT
    with pytest.raises(IllegalStateTransitionError):
        assert_valid_transition(OrderStatus.ACKED, OrderStatus.SENT)

    # Cannot resurrect a CANCELED order
    with pytest.raises(IllegalStateTransitionError):
        assert_valid_transition(OrderStatus.CANCELED, OrderStatus.ACKED)

    # Cannot resurrect a FILLED order
    with pytest.raises(IllegalStateTransitionError):
        assert_valid_transition(OrderStatus.FILLED, OrderStatus.PARTIAL)

    # Cannot go from REJECTED to anything
    with pytest.raises(IllegalStateTransitionError):
        assert_valid_transition(OrderStatus.REJECTED, OrderStatus.SENT)
