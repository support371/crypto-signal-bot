# backend/engine/venue_registry.py
"""
Venue registry — tracks available execution venues.

Venues:
  - exchange adapters (crypto): btcc, binance, bitget
  - broker adapters (FX/CFD): mt5

The registry allows the execution router to select the appropriate
venue based on symbol, mode, and health state.

Rules:
  - MT5 is marked unavailable when the bridge service is disconnected
  - Guardian kill switch is checked at coordinator level, not here
  - No trading logic here — registry only tracks availability
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class VenueInfo:
    venue_id:      str
    venue_type:    str          # "exchange" | "broker"
    available:     bool
    adapter:       object       # BaseExchangeAdapter or BrokerAdapter
    supported_symbols: set[str] = field(default_factory=set)
    last_health_at: int = 0
    error:         Optional[str] = None


_registry: dict[str, VenueInfo] = {}


def register_venue(
    venue_id:  str,
    venue_type: str,
    adapter:   object,
    available: bool = True,
) -> None:
    """Register a venue. Called at application startup."""
    _registry[venue_id] = VenueInfo(
        venue_id=venue_id,
        venue_type=venue_type,
        available=available,
        adapter=adapter,
        last_health_at=int(time.time()),
    )
    log.info("[VenueRegistry] Registered venue: %s type=%s available=%s",
             venue_id, venue_type, available)


def mark_available(venue_id: str, supported_symbols: Optional[set[str]] = None) -> None:
    if venue_id in _registry:
        _registry[venue_id].available = True
        _registry[venue_id].error = None
        _registry[venue_id].last_health_at = int(time.time())
        if supported_symbols is not None:
            _registry[venue_id].supported_symbols = supported_symbols
        log.info("[VenueRegistry] %s marked available.", venue_id)


def mark_unavailable(venue_id: str, error: Optional[str] = None) -> None:
    if venue_id in _registry:
        _registry[venue_id].available = False
        _registry[venue_id].error = error
        _registry[venue_id].last_health_at = int(time.time())
        log.warning("[VenueRegistry] %s marked unavailable: %s", venue_id, error)


def get_venue(venue_id: str) -> Optional[VenueInfo]:
    return _registry.get(venue_id)


def available_venues() -> list[VenueInfo]:
    return [v for v in _registry.values() if v.available]


def all_venues() -> list[VenueInfo]:
    return list(_registry.values())


def is_available(venue_id: str) -> bool:
    v = _registry.get(venue_id)
    return v is not None and v.available


def get_broker_venues() -> list[VenueInfo]:
    return [v for v in _registry.values() if v.venue_type == "broker"]


def get_exchange_venues() -> list[VenueInfo]:
    return [v for v in _registry.values() if v.venue_type == "exchange"]


def venues_for_symbol(internal_symbol: str) -> list[VenueInfo]:
    """Return all available venues that can trade a given symbol."""
    result = []
    for v in available_venues():
        if not v.supported_symbols or internal_symbol in v.supported_symbols:
            result.append(v)
    return result
