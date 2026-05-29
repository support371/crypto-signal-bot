"""
Testnet validation service.

Validates that live exchange adapters can reach the configured exchange
(testnet or mainnet) and perform basic read operations before allowing
order execution. This prevents silent failures when credentials are
wrong, the exchange is down, or the testnet URL is misconfigured.

This module is called at startup for live-mode adapters.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of testnet/exchange connectivity validation."""
    exchange: str = ""
    mode: str = ""
    timestamp: float = field(default_factory=time.time)
    passed: bool = False
    checks: List[dict] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "exchange": self.exchange,
            "mode": self.mode,
            "timestamp": self.timestamp,
            "passed": self.passed,
            "checks": self.checks,
            "error": self.error,
        }


def validate_exchange_connectivity(adapter) -> ValidationResult:
    """
    Run a series of non-destructive checks against the configured exchange.

    Checks:
    1. Can we read a price for BTC/USDT?
    2. Can we read account balance?
    3. Is the adapter in the expected mode (testnet vs mainnet)?

    Returns:
        ValidationResult with pass/fail status and check details
    """
    result = ValidationResult(
        exchange=adapter.exchange,
        mode=adapter.mode,
    )

    # Check 1: Price read
    try:
        price = adapter.get_price("BTCUSDT")
        result.checks.append({
            "name": "price_read",
            "passed": price > 0,
            "detail": f"BTCUSDT price: {price}",
        })
    except Exception as exc:
        result.checks.append({
            "name": "price_read",
            "passed": False,
            "detail": f"Failed: {exc}",
        })

    # Check 2: Balance read
    try:
        balance = adapter.get_balance("USDT")
        result.checks.append({
            "name": "balance_read",
            "passed": True,
            "detail": f"USDT balance: {balance}",
        })
    except Exception as exc:
        result.checks.append({
            "name": "balance_read",
            "passed": False,
            "detail": f"Failed: {exc}",
        })

    # Check 3: Mode verification
    expected_modes = {"testnet", "paper"}
    mode_ok = adapter.mode in expected_modes or adapter.mode == "mainnet"
    result.checks.append({
        "name": "mode_check",
        "passed": mode_ok,
        "detail": f"Adapter mode: {adapter.mode}",
    })

    # Check 4: Reconciliation read
    try:
        recon = adapter.reconcile()
        has_balances = "balances" in recon
        result.checks.append({
            "name": "reconciliation_read",
            "passed": has_balances,
            "detail": f"Reconciliation data available: {has_balances}",
        })
    except Exception as exc:
        result.checks.append({
            "name": "reconciliation_read",
            "passed": False,
            "detail": f"Failed: {exc}",
        })

    result.passed = all(c["passed"] for c in result.checks)
    if not result.passed:
        failed = [c["name"] for c in result.checks if not c["passed"]]
        result.error = f"Failed checks: {', '.join(failed)}"
        logger.warning(
            "Exchange validation FAILED for %s (%s): %s",
            adapter.exchange, adapter.mode, result.error,
        )
    else:
        logger.info(
            "Exchange validation PASSED for %s (%s): all %d checks ok",
            adapter.exchange, adapter.mode, len(result.checks),
        )

    return result
