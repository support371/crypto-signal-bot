"""
Unit tests for the Execution Gateway.
"""
import pytest
from backend.execution.gateway import get_execution_gateway, StubBitgetAdapter

def test_get_bitget_adapter():
    gateway = get_execution_gateway("bitget")
    assert isinstance(gateway, StubBitgetAdapter)

def test_unknown_venue_raises_error():
    with pytest.raises(ValueError, match="Unknown venue"):
        get_execution_gateway("unknown_venue")
