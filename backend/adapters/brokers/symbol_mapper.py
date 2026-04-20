# backend/adapters/brokers/symbol_mapper.py
"""
SymbolMapper — internal symbol ↔ broker symbol resolution.

Internal symbols follow the system convention (BTCUSDT, ETHUSDT).
Broker symbols vary by venue (BTCUSD on MT5, BTC/USDT on cTrader).

Config-driven aliases prevent hardcoded assumptions.
Default fallback rules are applied only when no explicit alias exists.
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.adapters.brokers.exceptions import BrokerSymbolMapError

log = logging.getLogger(__name__)

# Default alias map — applied when no config override exists
# Format: internal_symbol -> broker_symbol
_DEFAULT_ALIASES: dict[str, str] = {
    "BTCUSDT":  "BTCUSD",
    "ETHUSDT":  "ETHUSD",
    "SOLUSDT":  "SOLUSD",
    "BNBUSDT":  "BNBUSD",
    "ADAUSDT":  "ADAUSD",
    "XRPUSDT":  "XRPUSD",
    "DOTUSDT":  "DOTUSD",
    "AVAXUSDT": "AVAXUSD",
    "DOGEUSDT": "DOGEUSD",
    "LINKUSDT": "LINKUSD",
}


class SymbolMapper:
    """
    Resolves symbols between internal names and broker-specific names.

    Priority:
      1. Config-provided overrides (loaded via load_from_config)
      2. Default aliases (_DEFAULT_ALIASES)
      3. Suffix-strip fallback: BTCUSDT → BTCUSD (last 2 chars of USDT → USD)
    """

    def __init__(self, overrides: Optional[dict[str, str]] = None) -> None:
        # internal -> broker
        self._map: dict[str, str] = dict(_DEFAULT_ALIASES)
        # broker -> internal (reverse map)
        self._reverse: dict[str, str] = {v: k for k, v in self._map.items()}
        # Broker symbols that are actually registered (loaded from terminal)
        self._available: set[str] = set()

        if overrides:
            self._apply_overrides(overrides)

    def _apply_overrides(self, overrides: dict[str, str]) -> None:
        for internal, broker in overrides.items():
            internal_up = internal.upper()
            broker_up   = broker.upper()
            self._map[internal_up]    = broker_up
            self._reverse[broker_up]  = internal_up
        log.info("[SymbolMapper] Applied %d overrides.", len(overrides))

    def register_broker_symbols(self, broker_symbols: list[str]) -> None:
        """Called by the adapter after loading symbols from the terminal."""
        self._available = {s.upper() for s in broker_symbols}
        log.info("[SymbolMapper] Registered %d broker symbols.", len(self._available))

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------

    def to_broker(self, internal_symbol: str) -> Optional[str]:
        """
        Convert internal symbol to broker symbol.
        Returns None if no mapping exists or symbol is not available.
        """
        internal = internal_symbol.upper()

        # Explicit map
        broker = self._map.get(internal)
        if broker:
            # Verify it's actually available on this terminal
            if self._available and broker not in self._available:
                return None
            return broker

        # Fallback: XYZUSDT → XYZUSD
        if internal.endswith("USDT"):
            fallback = internal[:-2]   # strip "DT" → XYZUS → nope
            fallback = internal[:-4] + "USD"  # strip USDT, append USD
            if not self._available or fallback in self._available:
                self._map[internal]       = fallback
                self._reverse[fallback]   = internal
                log.debug("[SymbolMapper] Auto-mapped %s → %s", internal, fallback)
                return fallback

        return None

    def to_internal(self, broker_symbol: str) -> Optional[str]:
        """Convert broker symbol back to internal symbol."""
        broker = broker_symbol.upper()
        if broker in self._reverse:
            return self._reverse[broker]
        # Fallback: XYZUSD → XYZUSDT
        if broker.endswith("USD") and not broker.endswith("USDT"):
            candidate = broker + "T"
            if candidate in [k.upper() for k in self._map]:
                return candidate
        return None

    def validate_symbol_support(self, internal_symbol: str, strict: bool = False) -> bool:
        """
        Check if the internal symbol can be traded on this venue.
        If strict=True, raises BrokerSymbolMapError instead of returning False.
        """
        supported = self.to_broker(internal_symbol) is not None
        if not supported and strict:
            raise BrokerSymbolMapError(
                f"Symbol {internal_symbol!r} has no broker mapping and cannot be traded."
            )
        return supported

    def all_mappings(self) -> dict[str, str]:
        """Return current internal→broker map (read-only copy)."""
        return dict(self._map)

    def available_broker_symbols(self) -> set[str]:
        return set(self._available)


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

def load_symbol_map(config_overrides: Optional[dict] = None) -> SymbolMapper:
    """
    Factory: create a SymbolMapper with optional config overrides.

    Usage:
        mapper = load_symbol_map(config.mt5.symbol_map)
    """
    return SymbolMapper(overrides=config_overrides)


def resolve_internal_to_broker(
    internal_symbol: str,
    mapper: SymbolMapper,
) -> str:
    """Resolve or raise BrokerSymbolMapError."""
    result = mapper.to_broker(internal_symbol)
    if result is None:
        raise BrokerSymbolMapError(
            f"No broker symbol mapping for: {internal_symbol!r}"
        )
    return result


def resolve_broker_to_internal(
    broker_symbol: str,
    mapper: SymbolMapper,
) -> Optional[str]:
    return mapper.to_internal(broker_symbol)
