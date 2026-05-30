# backend/engine/signal_override.py
"""
Per-symbol signal-gate override store.

A thin, import-safe module that holds the one-shot override registry so
that both coordinator.py (engine layer) and console_v1.py (routes layer)
can share it without creating a circular import.

Design:
  - console_v1 calls set_override() / cancel_override()
  - coordinator calls consume_override() (one-shot, removes after use)
  - No FastAPI / Pydantic / service imports here
"""
from __future__ import annotations

import logging
import time
from typing import Dict

log = logging.getLogger(__name__)

_OVERRIDE_TTL = 300  # default 5 minutes

# symbol (upper) → unix expiry timestamp
_signal_overrides: Dict[str, int] = {}


def set_override(symbol: str, ttl_seconds: int = _OVERRIDE_TTL) -> int:
    """Register a one-shot override. Returns the expiry timestamp."""
    sym = symbol.upper()
    exp = int(time.time()) + ttl_seconds
    _signal_overrides[sym] = exp
    log.warning("[signal_override] override SET: symbol=%s ttl=%ds", sym, ttl_seconds)
    return exp


def cancel_override(symbol: str) -> bool:
    """Cancel an override. Returns True if it was present."""
    removed = _signal_overrides.pop(symbol.upper(), None) is not None
    if removed:
        log.info("[signal_override] override CANCELLED: symbol=%s", symbol.upper())
    return removed


def is_overridden(symbol: str) -> bool:
    """Check if a valid (non-expired) override exists for symbol."""
    exp = _signal_overrides.get(symbol.upper())
    if exp is None:
        return False
    if int(time.time()) > exp:
        _signal_overrides.pop(symbol.upper(), None)
        return False
    return True


def consume_override(symbol: str) -> bool:
    """
    One-shot consume: check + remove the override atomically.
    Returns True if a valid override was present (and consumed).
    """
    sym = symbol.upper()
    if is_overridden(sym):
        _signal_overrides.pop(sym, None)
        log.info("[signal_override] override CONSUMED for %s", sym)
        return True
    return False


def get_all_overrides() -> Dict[str, int]:
    """Return all currently active (non-expired) overrides."""
    now = int(time.time())
    # Purge expired first
    expired = [s for s, exp in _signal_overrides.items() if now > exp]
    for s in expired:
        _signal_overrides.pop(s, None)
    return dict(_signal_overrides)
