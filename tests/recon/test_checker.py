"""
Tests for the Reconciliation Engine's drift detection and freeze mechanism.
"""
import pytest
from unittest.mock import MagicMock
from backend.oms.manager import OrderManagementSystem
from backend.execution.gateway import ExecutionGateway
from backend.governance.gates import Governance
from backend.recon.checker import ReconciliationEngine
from backend.oms.models import Order # Need a concrete order for the test

@pytest.fixture
def mock_oms():
    oms = MagicMock(spec=OrderManagementSystem)
    return oms

@pytest.fixture
def mock_gateway():
    gateway = MagicMock(spec=ExecutionGateway)
    return gateway

@pytest.fixture
def governance():
    return Governance()

@pytest.fixture
def recon_engine(mock_oms, mock_gateway, governance):
    engine = ReconciliationEngine(mock_oms, mock_gateway, governance)
    # Set the tolerance to 3 cycles for the test
    engine._DRIFT_TOLERANCE_CYCLES = 3
    return engine

def test_recon_freezes_on_persistent_drift(recon_engine: ReconciliationEngine, mock_oms, mock_gateway, governance):
    """
    Verify that a persistent mismatch between OMS and gateway triggers a governance freeze.
    """
    # --- Create a mismatched state ---
    # OMS thinks an order is open, but the gateway does not.
    test_order = Order(intent_id="test-intent", symbol="BTC/USDT", quantity=0.1, action="ENTER_LONG", client_order_id="drift-order-1")
    mock_oms.get_open_orders.return_value = [test_order]
    mock_gateway.get_open_orders.return_value = []

    assert not governance.is_frozen

    # --- Run Recon Check - Cycle 1 ---
    recon_engine.run_check()
    assert not governance.is_frozen
    assert recon_engine._mismatch_counter == 1

    # --- Run Recon Check - Cycle 2 ---
    recon_engine.run_check()
    assert not governance.is_frozen
    assert recon_engine._mismatch_counter == 2

    # --- Run Recon Check - Cycle 3 (Freeze Trigger) ---
    recon_engine.run_check()
    assert governance.is_frozen
    assert recon_engine._mismatch_counter == 3

    # --- Verify State Remains Frozen ---
    recon_engine.run_check()
    assert governance.is_frozen

def test_recon_resets_counter_on_consistency(recon_engine: ReconciliationEngine, mock_oms, mock_gateway, governance):
    """
    Verify that the mismatch counter resets once the states become consistent again.
    """
    # --- Mismatched state ---
    test_order = Order(intent_id="test-intent", symbol="BTC/USDT", quantity=0.1, action="ENTER_LONG", client_order_id="drift-order-1")
    mock_oms.get_open_orders.return_value = [test_order]
    mock_gateway.get_open_orders.return_value = []

    # Run two cycles with mismatch
    recon_engine.run_check()
    recon_engine.run_check()
    assert recon_engine._mismatch_counter == 2
    assert not governance.is_frozen

    # --- Resolve the mismatch ---
    # Now, both OMS and gateway report the same open order
    mock_gateway.get_open_orders.return_value = [test_order]

    # --- Run Recon Check again ---
    recon_engine.run_check()

    # The counter should be reset to 0
    assert recon_engine._mismatch_counter == 0
    assert not governance.is_frozen
