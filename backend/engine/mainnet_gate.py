"""
Mainnet gate enforcement.

Prevents accidental mainnet execution unless explicitly unlocked via the
ALLOW_MAINNET environment variable. This is a compile-time safety check
that runs at adapter construction and during intent processing.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_ALLOW_MAINNET = os.getenv("ALLOW_MAINNET", "").strip().lower() in {"1", "true", "yes"}


class MainnetGateError(RuntimeError):
    """Raised when a mainnet operation is attempted without explicit opt-in."""


def is_mainnet_allowed() -> bool:
    """Return True if the ALLOW_MAINNET flag is explicitly set."""
    return _ALLOW_MAINNET


def assert_not_mainnet(network: str, trading_mode: str) -> None:
    """
    Raise MainnetGateError if attempting live trading on mainnet without opt-in.

    This should be called:
    1. At adapter construction time (in build_adapter)
    2. Before processing any live intent
    """
    if trading_mode != "live":
        return
    if network == "mainnet" and not _ALLOW_MAINNET:
        raise MainnetGateError(
            "ALLOW_MAINNET is not set. Mainnet live trading is blocked. "
            "Set ALLOW_MAINNET=true to enable real-money execution."
        )


def mainnet_status() -> dict:
    """Return the current mainnet gate status for health/status endpoints."""
    return {
        "mainnet_gate_active": not _ALLOW_MAINNET,
        "allow_mainnet": _ALLOW_MAINNET,
        "note": (
            "Mainnet execution is ALLOWED"
            if _ALLOW_MAINNET
            else "Mainnet execution is BLOCKED — set ALLOW_MAINNET=true to enable"
        ),
    }
