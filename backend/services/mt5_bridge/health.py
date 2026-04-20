# backend/services/mt5_bridge/health.py
"""
MT5 health builder.

Constructs a normalized MT5 health response from adapter state.
Called by the bridge service, routes, and venue registry health checks.

Returns MT5HealthModel (Pydantic).
Never raises — returns error state on any failure.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

log = logging.getLogger(__name__)


def build_health_dict(
    terminal_connected:  bool,
    broker_session_ok:   bool,
    symbols_loaded:      bool,
    order_path_ok:       bool,
    latency_ms:          Optional[float] = None,
    last_error:          Optional[str]   = None,
    venue:               str             = "mt5",
) -> dict:
    """
    Build a normalized health dict.
    Used by routes, Redis publication, and DB persistence.
    """
    return {
        "venue":               venue,
        "terminal_connected":  terminal_connected,
        "broker_session_ok":   broker_session_ok,
        "symbols_loaded":      symbols_loaded,
        "order_path_ok":       order_path_ok,
        "latency_ms":          latency_ms,
        "last_error":          last_error,
        "timestamp":           int(time.time()),
        "overall_ok":          terminal_connected and broker_session_ok and order_path_ok,
    }


async def get_adapter_health(adapter) -> dict:
    """
    Fetch health from a BrokerAdapter instance.
    Returns normalized health dict. Never raises.
    """
    try:
        h = await adapter.health()
        return build_health_dict(
            terminal_connected = h.terminal_connected,
            broker_session_ok  = h.broker_session_ok,
            symbols_loaded     = h.symbols_loaded,
            order_path_ok      = h.order_path_ok,
            latency_ms         = h.latency_ms,
            last_error         = h.last_error,
            venue              = h.venue,
        )
    except Exception as exc:
        log.warning("[MT5Health] Failed to get health: %s", exc)
        return build_health_dict(
            terminal_connected = False,
            broker_session_ok  = False,
            symbols_loaded     = False,
            order_path_ok      = False,
            last_error         = str(exc),
        )


def is_healthy(health: dict) -> bool:
    """Quick boolean check from a health dict."""
    return bool(health.get("overall_ok", False))


def health_changed(prev: Optional[dict], curr: dict) -> bool:
    """Return True if health state changed in any meaningful way."""
    if prev is None:
        return True
    return (
        prev.get("terminal_connected") != curr.get("terminal_connected")
        or prev.get("broker_session_ok") != curr.get("broker_session_ok")
        or prev.get("order_path_ok") != curr.get("order_path_ok")
    )
