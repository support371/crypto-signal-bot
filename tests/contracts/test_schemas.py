"""
Unit tests for all Pydantic data contracts to ensure validation works as expected.
"""

import pytest
from pydantic import ValidationError
from backend.contracts.schemas import (
    Signal,
    MarketPosture,
    ExecutionIntent,
    OrderUpdate,
    ExecutionReport,
    PortfolioState,
    AuditEvent
)

# ============================================================
# Signal Contract Tests
# ============================================================

def test_signal_valid():
    Signal(direction="UP", confidence=0.8, regime="TREND", horizon_minutes=60)

def test_signal_invalid_direction():
    with pytest.raises(ValidationError):
        Signal(direction="SIDEWAYS", confidence=0.8, regime="TREND", horizon_minutes=60)

def test_signal_invalid_confidence():
    with pytest.raises(ValidationError):
        Signal(direction="UP", confidence=1.1, regime="TREND", horizon_minutes=60)
    with pytest.raises(ValidationError):
        Signal(direction="UP", confidence=-0.1, regime="TREND", horizon_minutes=60)

def test_signal_missing_required_field():
    with pytest.raises(ValidationError):
        Signal(direction="UP", regime="TREND", horizon_minutes=60)

# ============================================================
# MarketPosture Contract Tests
# ============================================================

def test_market_posture_valid():
    MarketPosture(status="GREEN", reasons=["All systems nominal."])

def test_market_posture_invalid_status():
    with pytest.raises(ValidationError):
        MarketPosture(status="BLUE", reasons=[])

def test_market_posture_missing_status():
    with pytest.raises(ValidationError):
        MarketPosture(reasons=[])

# ============================================================
# ExecutionIntent Contract Tests
# ============================================================

def test_execution_intent_valid():
    ExecutionIntent(intent_id="intent_123", action="ENTER_LONG", symbol="BTC/USDT", size_fraction=0.1, reason="Signal confidence high", risk_score=40.0)

def test_execution_intent_invalid_action():
    with pytest.raises(ValidationError):
        ExecutionIntent(intent_id="intent_123", action="MAYBE_BUY", symbol="BTC/USDT", size_fraction=0.1, reason="Test", risk_score=40)

def test_execution_intent_missing_required_field():
    with pytest.raises(ValidationError):
        ExecutionIntent(action="ENTER_LONG", symbol="BTC/USDT", size_fraction=0.1, reason="Test", risk_score=40)

# ============================================================
# OrderUpdate Contract Tests
# ============================================================

def test_order_update_valid():
    OrderUpdate(order_id="order_456", client_order_id="client_abc", status="PARTIAL", filled_quantity=0.5, average_fill_price=50000.0)

def test_order_update_invalid_status():
    with pytest.raises(ValidationError):
        OrderUpdate(order_id="order_456", client_order_id="client_abc", status="THINKING", filled_quantity=0.5)

def test_order_update_missing_required_field():
    with pytest.raises(ValidationError):
        OrderUpdate(client_order_id="client_abc", status="NEW")

# ============================================================
# ExecutionReport Contract Tests
# ============================================================

def test_execution_report_valid():
    ExecutionReport(venue_order_id="v_789", fill_id="f_xyz", client_order_id="client_abc", symbol="ETH/USDT", side="BUY", quantity=1.0, price=3000.0, timestamp=1234567890)

def test_execution_report_invalid_side():
    with pytest.raises(ValidationError):
        ExecutionReport(venue_order_id="v_789", fill_id="f_xyz", client_order_id="client_abc", symbol="ETH/USDT", side="TOP", quantity=1.0, price=3000.0, timestamp=1234567890)

def test_execution_report_missing_required_field():
    with pytest.raises(ValidationError):
        ExecutionReport(fill_id="f_xyz", client_order_id="client_abc", symbol="ETH/USDT", side="SELL", quantity=1.0, price=3000.0, timestamp=1234567890)

# ============================================================
# PortfolioState Contract Tests
# ============================================================

def test_portfolio_state_valid():
    PortfolioState(nav=10000.0, exposure=0.2, positions={"BTC/USDT": 0.2}, balances={"USDT": 8000.0}, drawdown=0.05)

def test_portfolio_state_missing_required_field():
    with pytest.raises(ValidationError):
        PortfolioState(exposure=0.2, positions={}, balances={}, drawdown=0.05)

# ============================================================
# AuditEvent Contract Tests
# ============================================================

def test_audit_event_valid():
    AuditEvent(event_id="evt_aaa", trace_id="trace_bbb", event_type="SIGNAL_GENERATED", timestamp=1234567890, payload={"direction": "UP"})

def test_audit_event_missing_required_field():
    with pytest.raises(ValidationError):
        AuditEvent(trace_id="trace_bbb", event_type="RISK_CALCULATED", timestamp=1234567890, payload={})
