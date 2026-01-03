"""
Unit tests for the Posture Engine.
"""
import pytest
from backend.contracts.schemas import Signal
from backend.posture.engine import calculate_posture

@pytest.fixture
def green_signal() -> Signal:
    return Signal(direction="UP", confidence=0.8, regime="TREND", horizon_minutes=15)

@pytest.fixture
def low_confidence_signal() -> Signal:
    return Signal(direction="DOWN", confidence=0.45, regime="RANGE", horizon_minutes=15)

@pytest.fixture
def chaos_signal() -> Signal:
    return Signal(direction="NEUTRAL", confidence=0.7, regime="CHAOS", horizon_minutes=15)

def test_green_posture(green_signal):
    posture = calculate_posture(signal=green_signal, is_data_stale=False)
    assert posture.status == "GREEN"
    assert "Signal is clear and data is fresh." in posture.reasons

def test_red_posture_due_to_stale_data(green_signal):
    posture = calculate_posture(signal=green_signal, is_data_stale=True)
    assert posture.status == "RED"
    assert "Market data is stale or gapped." in posture.reasons

def test_amber_posture_due_to_low_confidence(low_confidence_signal):
    posture = calculate_posture(signal=low_confidence_signal, is_data_stale=False)
    assert posture.status == "AMBER"
    assert f"Signal confidence (0.45) is below threshold (0.55)." in posture.reasons

def test_amber_posture_due_to_chaos_regime(chaos_signal):
    posture = calculate_posture(signal=chaos_signal, is_data_stale=False)
    assert posture.status == "AMBER"
    assert "Market regime is 'CHAOS'." in posture.reasons

def test_amber_posture_due_to_multiple_reasons(low_confidence_signal):
    multi_reason_signal = Signal(direction="NEUTRAL", confidence=0.4, regime="CHAOS", horizon_minutes=15)
    posture = calculate_posture(signal=multi_reason_signal, is_data_stale=False)
    assert posture.status == "AMBER"
    assert len(posture.reasons) == 2
    assert "Market regime is 'CHAOS'." in posture.reasons
    assert f"Signal confidence (0.40) is below threshold (0.55)." in posture.reasons

def test_custom_confidence_threshold(green_signal):
    posture = calculate_posture(signal=green_signal, is_data_stale=False, confidence_threshold=0.85)
    assert posture.status == "AMBER"
    assert f"Signal confidence (0.80) is below threshold (0.85)." in posture.reasons

    posture = calculate_posture(signal=green_signal, is_data_stale=False, confidence_threshold=0.75)
    assert posture.status == "GREEN"
