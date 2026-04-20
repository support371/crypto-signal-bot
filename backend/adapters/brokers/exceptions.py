# backend/adapters/brokers/exceptions.py
"""
Broker-specific exceptions.

These are venue-agnostic and used across routes, engine, and bridge services.
MT5-specific errors are raised as one of these types after normalization
so the rest of the system never needs to import mt5 directly.
"""

from __future__ import annotations


class BrokerError(Exception):
    """Base class for all broker errors."""
    venue: str = "unknown"

    def __init__(self, message: str, venue: str = "unknown"):
        self.venue = venue
        super().__init__(f"[{venue}] {message}")


class BrokerConnectionError(BrokerError):
    """Terminal or network connection failed."""
    pass


class BrokerAuthError(BrokerError):
    """Login rejected — invalid credentials or session expired."""
    pass


class BrokerSymbolError(BrokerError):
    """Symbol not found, not tradable, or mapping failed."""
    pass


class BrokerOrderError(BrokerError):
    """Order rejected by the broker (margin, volume, etc.)."""
    def __init__(self, message: str, venue: str = "unknown",
                 broker_error_code: int | None = None):
        self.broker_error_code = broker_error_code
        super().__init__(message, venue)


class BrokerUnavailableError(BrokerError):
    """Broker or terminal is unreachable — transient failure."""
    pass


class BrokerPositionError(BrokerError):
    """Position operation failed (modify, close)."""
    pass


class BrokerSymbolMapError(BrokerError):
    """Symbol could not be resolved through the mapper."""
    pass
