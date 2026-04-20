# backend/adapters/brokers/base.py
"""
BrokerAdapter — abstract interface for broker venues.

Extends the existing exchange adapter pattern (backend/adapters/exchanges/base.py)
for broker-specific operations: SL/TP modification, position closing, magic numbers.

MT5BrokerAdapter implements this. Future venues (cTrader, OANDA) implement the same interface.

Rules:
  - No route logic here
  - No DB writes here
  - All MT5 outputs must be normalized into internal models before leaving this layer
  - Protected files are never imported here

Relationship to existing adapters:
  The exchange adapters (BaseExchangeAdapter) handle crypto exchange APIs.
  BrokerAdapter handles FX/CFD brokers. They are separate hierarchies sharing
  the same normalization principle.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional


# ---------------------------------------------------------------------------
# Return types — normalized before they leave the adapter
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BrokerAccountInfo:
    venue:         str
    login_id:      str
    server:        str
    equity:        Decimal
    balance:       Decimal
    margin:        Decimal
    free_margin:   Decimal
    margin_level:  float         # percent
    currency:      str
    leverage:      int
    timestamp:     int           # unix seconds


@dataclass(frozen=True)
class BrokerSymbol:
    venue:          str
    broker_symbol:  str          # e.g. "BTCUSD" on MT5
    internal_symbol: str         # e.g. "BTCUSDT" in our system
    base_asset:     str
    quote_asset:    str
    trade_mode:     int          # MT5: 0=disabled, 2=long+short
    visible:        bool
    contract_size:  float
    volume_min:     float
    volume_step:    float
    point:          float
    digits:         int


@dataclass(frozen=True)
class BrokerPosition:
    venue:          str
    position_id:    str
    symbol:         str          # internal symbol
    broker_symbol:  str          # broker symbol
    side:           str          # "LONG" | "SHORT"
    volume:         Decimal
    entry_price:    Decimal
    current_price:  Decimal
    sl:             Optional[Decimal]
    tp:             Optional[Decimal]
    unrealized_pnl: Decimal
    swap:           Decimal
    comment:        str
    magic_number:   int
    opened_at:      int          # unix seconds
    updated_at:     int


@dataclass(frozen=True)
class BrokerOrder:
    venue:             str
    client_order_id:   str
    broker_order_id:   str
    symbol:            str       # internal symbol
    broker_symbol:     str
    side:              str       # "BUY" | "SELL"
    order_type:        str       # "MARKET" | "LIMIT" | "STOP"
    volume:            Decimal
    requested_price:   Optional[Decimal]
    fill_price:        Optional[Decimal]
    sl:                Optional[Decimal]
    tp:                Optional[Decimal]
    status:            str       # "PENDING" | "FILLED" | "CANCELLED" | "PARTIAL" | "EXPIRED"
    comment:           str
    magic_number:      int
    reason:            Optional[str]
    created_at:        int
    updated_at:        int


@dataclass(frozen=True)
class BrokerFill:
    venue:           str
    fill_id:         str
    broker_order_id: str
    position_id:     Optional[str]
    symbol:          str         # internal symbol
    broker_symbol:   str
    side:            str
    volume:          Decimal
    price:           Decimal
    fee:             Decimal
    realized_pnl:    Decimal
    timestamp:       int


@dataclass(frozen=True)
class BrokerQuote:
    venue:         str
    symbol:        str           # internal symbol
    broker_symbol: str
    bid:           Decimal
    ask:           Decimal
    spread:        Decimal
    timestamp:     int


@dataclass(frozen=True)
class BrokerHealth:
    venue:                str
    terminal_connected:   bool
    broker_session_ok:    bool
    symbols_loaded:       bool
    order_path_ok:        bool
    latency_ms:           Optional[float]
    last_error:           Optional[str]
    timestamp:            int


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class BrokerAdapter(ABC):
    """
    Abstract interface for all broker adapters.

    Concrete subclasses:
      - MT5BrokerAdapter  (this integration)
      - Future: cTraderAdapter, OANDAAdapter

    Rules:
      - All outputs must be normalized (no raw MT5 types crossing this boundary)
      - No route logic
      - No DB writes
      - Fail loudly with typed BrokerError subclasses
    """

    venue_name: str = "base"

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @abstractmethod
    async def connect(self) -> None:
        """Initialize terminal and login. Raises BrokerConnectionError or BrokerAuthError."""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Clean shutdown. Best-effort — must not raise."""
        ...

    @abstractmethod
    async def health(self) -> BrokerHealth:
        """Return current health. Must never raise — return error state instead."""
        ...

    # ------------------------------------------------------------------
    # Account
    # ------------------------------------------------------------------

    @abstractmethod
    async def account_info(self) -> BrokerAccountInfo:
        """Fetch normalized account info."""
        ...

    @abstractmethod
    async def symbols(self) -> list[BrokerSymbol]:
        """Fetch available tradeable symbols mapped to internal names."""
        ...

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    @abstractmethod
    async def quote(self, symbol: str) -> BrokerQuote:
        """
        Fetch current bid/ask for an internal symbol.
        Raises BrokerSymbolError if symbol is not available.
        """
        ...

    # ------------------------------------------------------------------
    # Positions and orders
    # ------------------------------------------------------------------

    @abstractmethod
    async def positions(self) -> list[BrokerPosition]:
        """Fetch all open positions."""
        ...

    @abstractmethod
    async def orders(self, limit: int = 100) -> list[BrokerOrder]:
        """Fetch pending orders."""
        ...

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    @abstractmethod
    async def submit_order(
        self,
        internal_symbol: str,
        side:            str,
        order_type:      str,
        volume:          Decimal,
        price:           Optional[Decimal] = None,
        sl:              Optional[Decimal] = None,
        tp:              Optional[Decimal] = None,
        comment:         str = "",
        magic_number:    int = 0,
    ) -> BrokerOrder:
        """
        Submit an order. Returns normalized BrokerOrder.
        Raises BrokerOrderError on rejection.
        """
        ...

    @abstractmethod
    async def modify_position(
        self,
        position_id: str,
        sl:          Optional[Decimal] = None,
        tp:          Optional[Decimal] = None,
    ) -> BrokerPosition:
        """Modify SL/TP on an open position."""
        ...

    @abstractmethod
    async def close_position(
        self,
        position_id: str,
        volume:      Optional[Decimal] = None,
    ) -> BrokerFill:
        """
        Close a position (full or partial).
        Returns normalized fill record.
        """
        ...

    @abstractmethod
    async def cancel_order(self, broker_order_id: str) -> BrokerOrder:
        """Cancel a pending order."""
        ...

    # ------------------------------------------------------------------
    # Symbol utilities
    # ------------------------------------------------------------------

    @abstractmethod
    def normalize_symbol(self, internal_symbol: str) -> str:
        """Convert internal symbol (BTCUSDT) to broker symbol (BTCUSD)."""
        ...

    @abstractmethod
    def supports_symbol(self, internal_symbol: str) -> bool:
        """Return True if this venue can trade the given internal symbol."""
        ...
