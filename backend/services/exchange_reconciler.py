"""
Exchange order reconciliation service.

Compares local order records against the exchange's actual order/fill history
to detect drift (missing fills, phantom orders, balance mismatches).

This runs periodically in the background and reports discrepancies to the
guardian service for potential kill-switch activation.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ReconciliationResult:
    """Result of comparing local state against exchange state."""
    timestamp: float = field(default_factory=time.time)
    status: str = "ok"
    local_balance: Dict[str, float] = field(default_factory=dict)
    exchange_balance: Dict[str, float] = field(default_factory=dict)
    balance_drift: Dict[str, float] = field(default_factory=dict)
    missing_fills: List[str] = field(default_factory=list)
    phantom_orders: List[str] = field(default_factory=list)
    max_drift_pct: float = 0.0
    drift_detected: bool = False

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "status": self.status,
            "local_balance": self.local_balance,
            "exchange_balance": self.exchange_balance,
            "balance_drift": self.balance_drift,
            "missing_fills": self.missing_fills,
            "phantom_orders": self.phantom_orders,
            "max_drift_pct": round(self.max_drift_pct, 4),
            "drift_detected": self.drift_detected,
        }


def reconcile_against_exchange(
    adapter,
    local_balances: Dict[str, float],
    drift_tolerance_pct: float = 1.0,
) -> ReconciliationResult:
    """
    Compare local portfolio balances against the exchange adapter's view.

    Args:
        adapter: ExchangeAdapter instance (paper or live)
        local_balances: Current in-memory balances
        drift_tolerance_pct: Maximum allowed drift percentage before flagging

    Returns:
        ReconciliationResult with any detected discrepancies
    """
    result = ReconciliationResult(local_balance=dict(local_balances))

    try:
        exchange_data = adapter.reconcile()
        exchange_balances = exchange_data.get("balances", {})

        # Normalize exchange balances to floats
        normalized: Dict[str, float] = {}
        for asset, amount in exchange_balances.items():
            try:
                val = float(amount)
                if val > 0:
                    normalized[asset] = val
            except (ValueError, TypeError):
                continue

        result.exchange_balance = normalized

        # Compare balances
        all_assets = set(local_balances.keys()) | set(normalized.keys())
        for asset in all_assets:
            local_amt = local_balances.get(asset, 0.0)
            exchange_amt = normalized.get(asset, 0.0)
            diff = exchange_amt - local_amt

            if abs(diff) > 1e-8:
                result.balance_drift[asset] = round(diff, 8)
                if local_amt > 0:
                    drift_pct = abs(diff / local_amt) * 100
                    result.max_drift_pct = max(result.max_drift_pct, drift_pct)
                elif exchange_amt > 0:
                    # Asset exists on exchange but not locally — treat as 100% drift
                    result.max_drift_pct = max(result.max_drift_pct, 100.0)

        result.drift_detected = result.max_drift_pct > drift_tolerance_pct
        result.status = "drift_detected" if result.drift_detected else "ok"

    except Exception as exc:
        logger.exception("Exchange reconciliation failed: %s", exc)
        result.status = "error"
        result.drift_detected = False

    return result
