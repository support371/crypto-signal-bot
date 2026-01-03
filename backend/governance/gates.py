"""
Safety and governance layer for the trading platform.

This module provides the core safety gates that must be checked before any
live trading action is taken. It manages kill switches, a latched FREEZE mode,
and the global TRADING_ENABLED flag.
"""
import os
import logging
from typing import Set

# Configure a basic logger
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============================================================
# Custom Exception
# ============================================================

class TradingHaltedError(Exception):
    """Custom exception raised when a trading action is blocked by a governance gate."""
    pass

# ============================================================
# Governance State Manager
# ============================================================

class Governance:
    """
    Manages the state of all trading gates and kill switches.
    """
    def __init__(self):
        self.trading_enabled: bool = os.getenv("TRADING_ENABLED", "false").lower() == "true"
        self.is_frozen: bool = False
        self.global_kill_switch: bool = False
        self.strategy_kill_switches: Set[str] = set()
        self.venue_kill_switches: Set[str] = set()
        logger.info(f"Governance initialized with TRADING_ENABLED={self.trading_enabled}")

    def set_freeze_mode(self, freeze: bool, reason: str = ""):
        """Latches or unlatches the global FREEZE mode."""
        self.is_frozen = freeze
        logger.warning(f"Trading FREEZE mode set to {freeze}. Reason: {reason or 'N/A'}")

    def activate_global_kill(self, reason: str = ""):
        """Activates the global kill switch."""
        self.global_kill_switch = True
        logger.critical(f"GLOBAL KILL SWITCH ACTIVATED. Reason: {reason or 'N/A'}")

    def deactivate_global_kill(self):
        """Deactivates the global kill switch."""
        self.global_kill_switch = False
        logger.warning("Global kill switch deactivated.")

    def kill_strategy(self, strategy_id: str):
        """Activates the kill switch for a specific strategy."""
        self.strategy_kill_switches.add(strategy_id)
        logger.warning(f"Strategy kill switch activated for: {strategy_id}")

    def revive_strategy(self, strategy_id: str):
        """Deactivates the kill switch for a specific strategy."""
        self.strategy_kill_switches.discard(strategy_id)
        logger.info(f"Strategy kill switch deactivated for: {strategy_id}")

    def kill_venue(self, venue_id: str):
        """Activates the kill switch for a specific venue."""
        self.venue_kill_switches.add(venue_id)
        logger.warning(f"Venue kill switch activated for: {venue_id}")

    def revive_venue(self, venue_id: str):
        """Deactivates the kill switch for a specific venue."""
        self.venue_kill_switches.discard(venue_id)
        logger.info(f"Venue kill switch deactivated for: {venue_id}")

# ============================================================
# Enforcement Function
# ============================================================

def assert_trading_allowed(
    governance: Governance,
    strategy_id: str | None = None,
    venue_id: str | None = None
):
    """
    The core enforcement function. Raises TradingHaltedError if any gate is closed.
    """
    if not governance.trading_enabled:
        raise TradingHaltedError("Trading is globally disabled (TRADING_ENABLED=false).")

    if governance.is_frozen:
        raise TradingHaltedError("Trading is frozen due to a critical system event (e.g., reconciliation failure).")

    if governance.global_kill_switch:
        raise TradingHaltedError("Global kill switch is active.")

    if strategy_id and strategy_id in governance.strategy_kill_switches:
        raise TradingHaltedError(f"Strategy '{strategy_id}' is kill-switched.")

    if venue_id and venue_id in governance.venue_kill_switches:
        raise TradingHaltedError(f"Venue '{venue_id}' is kill-switched.")

    return True
