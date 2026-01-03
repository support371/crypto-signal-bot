"""
Unit tests for the Governance module to ensure all safety gates work correctly.
"""

import os
import pytest
from backend.governance.gates import Governance, assert_trading_allowed, TradingHaltedError

# ============================================================
# Test Fixture
# ============================================================

@pytest.fixture
def gov():
    """Provides a fresh instance of the Governance class for each test."""
    # Unset the env var to ensure tests are isolated
    os.environ.pop("TRADING_ENABLED", None)

    instance = Governance()

    # Default state for most tests is TRADING_ENABLED=true, all switches off
    instance.trading_enabled = True

    yield instance

    # Clean up after test
    os.environ.pop("TRADING_ENABLED", None)

# ============================================================
# Test Cases
# ============================================================

def test_trading_allowed_by_default(gov):
    """Tests that trading is allowed when TRADING_ENABLED=true and all switches are off."""
    assert assert_trading_allowed(gov, strategy_id="strat1", venue_id="venue1") is True

def test_trading_disabled_by_env_var():
    """Tests that trading is blocked if TRADING_ENABLED is 'false' or not set."""
    # Test when not set
    os.environ.pop("TRADING_ENABLED", None)
    gov_disabled = Governance()
    with pytest.raises(TradingHaltedError, match="globally disabled"):
        assert_trading_allowed(gov_disabled)

    # Test when explicitly 'false'
    os.environ["TRADING_ENABLED"] = "false"
    gov_disabled_false = Governance()
    with pytest.raises(TradingHaltedError, match="globally disabled"):
        assert_trading_allowed(gov_disabled_false)

def test_trading_enabled_by_env_var():
    """Tests that trading is allowed when TRADING_ENABLED is explicitly 'true'."""
    os.environ["TRADING_ENABLED"] = "true"
    gov_enabled = Governance()
    assert assert_trading_allowed(gov_enabled) is True

def test_global_kill_switch(gov):
    """Tests that the global kill switch blocks trading."""
    gov.activate_global_kill("Emergency stop")
    with pytest.raises(TradingHaltedError, match="Global kill switch"):
        assert_trading_allowed(gov)

    gov.deactivate_global_kill()
    assert assert_trading_allowed(gov) is True

def test_freeze_mode(gov):
    """Tests that FREEZE mode blocks trading."""
    gov.set_freeze_mode(True, "Recon mismatch")
    with pytest.raises(TradingHaltedError, match="Trading is frozen"):
        assert_trading_allowed(gov)

    gov.set_freeze_mode(False)
    assert assert_trading_allowed(gov) is True

def test_strategy_kill_switch(gov):
    """Tests that a specific strategy can be kill-switched."""
    gov.kill_strategy("strat_A")

    # strat_A should be blocked
    with pytest.raises(TradingHaltedError, match="Strategy 'strat_A' is kill-switched"):
        assert_trading_allowed(gov, strategy_id="strat_A")

    # Other strategies should be allowed
    assert assert_trading_allowed(gov, strategy_id="strat_B") is True
    assert assert_trading_allowed(gov) is True # No strategy context

    gov.revive_strategy("strat_A")
    assert assert_trading_allowed(gov, strategy_id="strat_A") is True

def test_venue_kill_switch(gov):
    """Tests that a specific venue can be kill-switched."""
    gov.kill_venue("venue_X")

    # venue_X should be blocked
    with pytest.raises(TradingHaltedError, match="Venue 'venue_X' is kill-switched"):
        assert_trading_allowed(gov, venue_id="venue_X")

    # Other venues should be allowed
    assert assert_trading_allowed(gov, venue_id="venue_Y") is True
    assert assert_trading_allowed(gov) is True # No venue context

    gov.revive_venue("venue_X")
    assert assert_trading_allowed(gov, venue_id="venue_X") is True

def test_multiple_gates_active(gov):
    """Tests that any single active gate is sufficient to block trading."""
    gov.kill_strategy("strat_A")
    gov.kill_venue("venue_X")

    # Freeze mode should take precedence in messaging
    gov.set_freeze_mode(True)
    with pytest.raises(TradingHaltedError, match="Trading is frozen"):
        assert_trading_allowed(gov, strategy_id="strat_A", venue_id="venue_X")

    gov.set_freeze_mode(False)

    # Strategy should be blocked even if venue is different
    with pytest.raises(TradingHaltedError, match="Strategy 'strat_A'"):
        assert_trading_allowed(gov, strategy_id="strat_A", venue_id="venue_Y")

    # Venue should be blocked even if strategy is different
    with pytest.raises(TradingHaltedError, match="Venue 'venue_X'"):
        assert_trading_allowed(gov, strategy_id="strat_B", venue_id="venue_X")
