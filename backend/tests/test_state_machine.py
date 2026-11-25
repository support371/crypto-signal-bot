"""Tests for the intent state machine (backend/engine/state_machine.py)."""

import pytest

from backend.models.execution_intent import ExecutionIntent, IntentStatus, Side
from backend.engine.state_machine import (
    transition,
    is_terminal,
    get_valid_transitions,
    StateTransitionError,
)


def _make_intent() -> ExecutionIntent:
    return ExecutionIntent(symbol="BTC/USDT", side=Side.BUY, quantity=0.01)


class TestValidTransitions:
    def test_pending_to_risk_approved(self):
        intent = _make_intent()
        result = transition(intent, IntentStatus.RISK_APPROVED)
        assert result.status == IntentStatus.RISK_APPROVED

    def test_pending_to_risk_rejected(self):
        intent = _make_intent()
        result = transition(intent, IntentStatus.RISK_REJECTED, notes="Too risky")
        assert result.status == IntentStatus.RISK_REJECTED
        assert result.notes == "Too risky"

    def test_risk_approved_to_submitted(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        result = transition(intent, IntentStatus.SUBMITTED)
        assert result.status == IntentStatus.SUBMITTED

    def test_submitted_to_filled(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        result = transition(intent, IntentStatus.FILLED, fill_price=50000.0)
        assert result.status == IntentStatus.FILLED
        assert result.fill_price == 50000.0

    def test_submitted_to_partially_filled(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        result = transition(intent, IntentStatus.PARTIALLY_FILLED, fill_quantity=0.005)
        assert result.status == IntentStatus.PARTIALLY_FILLED
        assert result.fill_quantity == 0.005

    def test_partially_filled_to_filled(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        transition(intent, IntentStatus.PARTIALLY_FILLED)
        result = transition(intent, IntentStatus.FILLED)
        assert result.status == IntentStatus.FILLED

    def test_submitted_to_cancelled(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        result = transition(intent, IntentStatus.CANCELLED)
        assert result.status == IntentStatus.CANCELLED

    def test_submitted_to_failed(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        result = transition(intent, IntentStatus.FAILED, notes="Exchange error")
        assert result.status == IntentStatus.FAILED


class TestInvalidTransitions:
    def test_pending_to_filled_raises(self):
        intent = _make_intent()
        with pytest.raises(StateTransitionError):
            transition(intent, IntentStatus.FILLED)

    def test_risk_rejected_is_terminal(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_REJECTED)
        with pytest.raises(StateTransitionError):
            transition(intent, IntentStatus.RISK_APPROVED)

    def test_filled_is_terminal(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        transition(intent, IntentStatus.FILLED)
        with pytest.raises(StateTransitionError):
            transition(intent, IntentStatus.CANCELLED)

    def test_cancelled_is_terminal(self):
        intent = _make_intent()
        transition(intent, IntentStatus.RISK_APPROVED)
        transition(intent, IntentStatus.SUBMITTED)
        transition(intent, IntentStatus.CANCELLED)
        with pytest.raises(StateTransitionError):
            transition(intent, IntentStatus.FILLED)


class TestHelpers:
    def test_is_terminal_for_terminal_states(self):
        assert is_terminal(IntentStatus.FILLED)
        assert is_terminal(IntentStatus.CANCELLED)
        assert is_terminal(IntentStatus.FAILED)
        assert is_terminal(IntentStatus.RISK_REJECTED)

    def test_is_terminal_for_non_terminal(self):
        assert not is_terminal(IntentStatus.PENDING)
        assert not is_terminal(IntentStatus.RISK_APPROVED)
        assert not is_terminal(IntentStatus.SUBMITTED)
        assert not is_terminal(IntentStatus.PARTIALLY_FILLED)

    def test_get_valid_transitions(self):
        targets = get_valid_transitions(IntentStatus.PENDING)
        assert IntentStatus.RISK_APPROVED in targets
        assert IntentStatus.RISK_REJECTED in targets
        assert IntentStatus.FILLED not in targets

    def test_transition_updates_timestamp(self):
        intent = _make_intent()
        old_ts = intent.updated_at
        transition(intent, IntentStatus.RISK_APPROVED)
        assert intent.updated_at >= old_ts
