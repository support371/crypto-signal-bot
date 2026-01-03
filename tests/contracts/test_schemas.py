"""
Unit tests for the Pydantic data contracts in backend/contracts/schemas.py
"""

import pytest
from pydantic import ValidationError
from backend.contracts.schemas import Signal

def test_signal_validation_success():
    """Tests that a valid Signal object passes validation."""
    valid_data = {
        "direction": "UP",
        "confidence": 0.75,
        "regime": "TREND",
        "horizon_minutes": 15,
        "meta": {"source": "test"}
    }
    signal = Signal(**valid_data)
    assert signal.direction == "UP"
    assert signal.confidence == 0.75

def test_signal_missing_required_field():
    """Tests that validation fails if a required field (e.g., confidence) is missing."""
    invalid_data = {
        "direction": "DOWN",
        "regime": "RANGE",
        "horizon_minutes": 5
    }
    with pytest.raises(ValidationError) as excinfo:
        Signal(**invalid_data)
    assert "confidence" in str(excinfo.value)

def test_signal_invalid_enum_value():
    """Tests that validation fails if an invalid enum value is provided for direction."""
    invalid_data = {
        "direction": "SIDEWAYS",  # Invalid direction
        "confidence": 0.5,
        "regime": "CHAOS",
        "horizon_minutes": 10
    }
    with pytest.raises(ValidationError) as excinfo:
        Signal(**invalid_data)
    assert "direction" in str(excinfo.value)

def test_signal_confidence_out_of_bounds():
    """Tests that validation fails if confidence is outside the allowed range [0.0, 1.0]."""
    invalid_data = {
        "direction": "UP",
        "confidence": 1.1,  # > 1.0
        "regime": "TREND",
        "horizon_minutes": 15
    }
    with pytest.raises(ValidationError) as excinfo:
        Signal(**invalid_data)
    assert "confidence" in str(excinfo.value)

    invalid_data["confidence"] = -0.1  # < 0.0
    with pytest.raises(ValidationError) as excinfo:
        Signal(**invalid_data)
    assert "confidence" in str(excinfo.value)

def test_signal_horizon_not_positive():
    """Tests that validation fails if horizon_minutes is not a positive integer."""
    invalid_data = {
        "direction": "NEUTRAL",
        "confidence": 0.5,
        "regime": "RANGE",
        "horizon_minutes": 0  # Not > 0
    }
    with pytest.raises(ValidationError) as excinfo:
        Signal(**invalid_data)
    assert "horizon_minutes" in str(excinfo.value)
