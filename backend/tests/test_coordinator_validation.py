"""Tests for the coordinator validation and types (backend/engine/coordinator.py).

Tests only the synchronous, side-effect-free parts: intent validation and types.
The async execute_intent path requires Redis/guardian mocks — tested elsewhere.
"""

from decimal import Decimal

import pytest

from backend.engine.coordinator import (
    ExecutionIntent,
    ExecutionResult,
    IntentValidationError,
    KillSwitchActive,
    RiskGateDenied,
    SignalGateDenied,
    validate_intent,
    VALID_SYMBOLS,
    VALID_SIDES,
    VALID_TYPES,
    MIN_QUANTITY,
    MAX_QUANTITY,
)


def _make_intent(**overrides):
    defaults = dict(
        symbol="BTCUSDT", side="BUY", order_type="MARKET",
        quantity=Decimal("0.1"), price=None, mode="paper",
    )
    defaults.update(overrides)
    return ExecutionIntent(**defaults)


class TestValidateIntent:
    def test_valid_market_buy(self):
        validate_intent(_make_intent())

    def test_valid_limit_buy(self):
        validate_intent(_make_intent(
            order_type="LIMIT", price=Decimal("50000")
        ))

    def test_all_valid_symbols(self):
        for sym in VALID_SYMBOLS:
            validate_intent(_make_intent(symbol=sym))

    def test_invalid_symbol(self):
        with pytest.raises(IntentValidationError, match="not in tracked list"):
            validate_intent(_make_intent(symbol="FAKEUSDT"))

    def test_invalid_side(self):
        with pytest.raises(IntentValidationError, match="Invalid side"):
            validate_intent(_make_intent(side="HOLD"))

    def test_invalid_order_type(self):
        with pytest.raises(IntentValidationError, match="Invalid order_type"):
            validate_intent(_make_intent(order_type="STOP"))

    def test_quantity_too_small(self):
        with pytest.raises(IntentValidationError, match="out of range"):
            validate_intent(_make_intent(quantity=Decimal("0.000001")))

    def test_quantity_too_large(self):
        with pytest.raises(IntentValidationError, match="out of range"):
            validate_intent(_make_intent(quantity=Decimal("99999")))

    def test_limit_without_price(self):
        with pytest.raises(IntentValidationError, match="require a price"):
            validate_intent(_make_intent(order_type="LIMIT", price=None))

    def test_min_boundary(self):
        validate_intent(_make_intent(quantity=MIN_QUANTITY))

    def test_max_boundary(self):
        validate_intent(_make_intent(quantity=MAX_QUANTITY))

    def test_case_insensitive_symbol(self):
        validate_intent(_make_intent(symbol="btcusdt"))


class TestExceptionTypes:
    def test_kill_switch_active(self):
        exc = KillSwitchActive("halted")
        assert str(exc) == "halted"

    def test_risk_gate_denied(self):
        exc = RiskGateDenied("too risky")
        assert exc.reason == "too risky"
        assert str(exc) == "too risky"

    def test_signal_gate_denied(self):
        exc = SignalGateDenied("signal contradicts")
        assert exc.reason == "signal contradicts"


class TestExecutionIntentDataclass:
    def test_defaults(self):
        intent = _make_intent()
        assert intent.mode == "paper"
        assert intent.price is None
        assert intent.notes is None

    def test_all_fields(self):
        intent = ExecutionIntent(
            symbol="ETHUSDT", side="SELL", order_type="LIMIT",
            quantity=Decimal("1"), price=Decimal("3000"),
            mode="live", notes="test note",
        )
        assert intent.symbol == "ETHUSDT"
        assert intent.notes == "test note"


class TestExecutionResultDataclass:
    def test_construction(self):
        intent = _make_intent()
        result = ExecutionResult(
            intent=intent, order_id="ord123", status="FILLED",
            fill_price=Decimal("50100"), filled_qty=Decimal("0.1"),
            venue="btcc", realized_pnl=Decimal("10"),
            created_at=1000, elapsed_ms=50,
        )
        assert result.order_id == "ord123"
        assert result.status == "FILLED"
        assert result.error is None
