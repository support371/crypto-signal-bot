# backend/adapters/exchanges/base.py
"""
PHASE 5 — Abstract exchange adapter contract.

Rules enforced here:
  - Rule 9: Paper and live adapters produce identical output shapes.
    Only the exchange adapter itself differs between modes.
    The rest of the system (risk, signal, guardian) sees the same types.
  - No ad-hoc exchange calls in execution paths outside this layer.
  - No live client-side exchange access (already removed in Phase 3).

All exchange adapters inherit from BaseExchangeAdapter and implement
every abstract method. The type contracts below are the single source
of truth for exchange data shapes in this repo.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


# ---------------------------------------------------------------------------
# Output types — shared across all adapters (paper and live)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Ticker:
    symbol:     str
    price:      Decimal
    bid:        Decimal
    ask:        Decimal
    spread:     Decimal          # ask - bid
    change24h:  float            # percent, e.g. 2.34 means +2.34%
    volume24h:  Decimal
    timestamp:  int              # unix seconds (UTC)

    @property
    def spread_pct(self) -> float:
        if self.price == 0:
            return 0.0
        return float(self.spread / self.price)


@dataclass(frozen=True)
class Balance:
    asset:  str
    free:   Decimal
    locked: Decimal

    @property
    def total(self) -> Decimal:
        return self.free + self.locked


@dataclass(frozen=True)
class Position:
    symbol:          str
    side:            str     # "LONG" | "SHORT"
    quantity:        Decimal
    entry_price:     Decimal
    mark_price:      Decimal
    unrealized_pnl:  Decimal
    leverage:        int = 1


@dataclass(frozen=True)
class Order:
    id:           str
    symbol:       str
    side:         str            # "BUY" | "SELL"
    order_type:   str            # "MARKET" | "LIMIT"
    quantity:     Decimal
    price:        Optional[Decimal]       # None for MARKET orders
    fill_price:   Optional[Decimal]       # None until filled
    filled_qty:   Decimal = Decimal("0")
    status:       str = "PENDING"
    # Status values: PENDING | FILLED | PARTIALLY_FILLED | CANCELLED | FAILED | RISK_REJECTED
    created_at:   int = 0        # unix seconds
    updated_at:   int = 0        # unix seconds
    exchange_order_id: Optional[str] = None
    reject_reason:     Optional[str] = None


@dataclass(frozen=True)
class OhlcvCandle:
    time:   int      # unix seconds, candle open time
    open:   Decimal
    high:   Decimal
    low:    Decimal
    close:  Decimal
    volume: Decimal


@dataclass(frozen=True)
class ExchangeStatus:
    connected:            bool
    mode:                 str    # "paper" | "live"
    exchange_name:        str
    market_data_available: bool
    market_data_mode:     str    # "live_public_paper" | "live" | "synthetic"
    connection_state:     str    # "connected" | "degraded" | "offline"
    fallback_active:      bool
    stale:                bool
    source:               Optional[str]
    error:                Optional[str]


# ---------------------------------------------------------------------------
# Adapter errors — typed so callers can handle them specifically
# ---------------------------------------------------------------------------

class AdapterError(Exception):
    """Base class for all adapter errors."""
    pass


class AdapterAuthError(AdapterError):
    """API key or secret is invalid / rejected by the exchange."""
    pass


class AdapterRateLimitError(AdapterError):
    """Exchange rate limit exceeded."""
    pass


class AdapterSymbolNotFoundError(AdapterError):
    """Requested symbol is not traded on this exchange."""
    pass


class AdapterOrderError(AdapterError):
    """Order was rejected or failed at the exchange level."""
    pass


class AdapterUnavailableError(AdapterError):
    """Exchange API is unreachable or returning unexpected errors."""
    pass


# ---------------------------------------------------------------------------
# Abstract base adapter
# ---------------------------------------------------------------------------

class BaseExchangeAdapter(ABC):
    """
    Abstract contract for all exchange adapters.

    Concrete subclasses:
      - PaperBinanceAdapter    (paper mode, Binance-based simulation)
      - LiveBinanceAdapter     (live mode, real Binance REST)
      - PaperBtccAdapter
      - LiveBtccAdapter
      - PaperBitgetAdapter
      - LiveBitgetAdapter

    Rule 9: Paper and live adapters inherit from the same base and
    return the same types. The only difference is whether orders are
    submitted to a real exchange or to the paper ledger.
    """

    exchange_name: str = "base"  # Override in subclasses

    def __init__(
        self,
        api_key:    Optional[str] = None,
        api_secret: Optional[str] = None,
        paper:      bool = True,
        **kwargs: object,
    ) -> None:
        self.api_key    = api_key
        self.api_secret = api_secret
        self.paper      = paper

    # ------------------------------------------------------------------
    # Market data (public — same in paper and live)
    # ------------------------------------------------------------------

    @abstractmethod
    async def fetch_ticker(self, symbol: str) -> Ticker:
        """
        Fetch current ticker for a symbol (e.g. 'BTCUSDT').
        Must return real market data in both paper and live mode
        (paper mode still uses real prices for simulation accuracy).
        Raises AdapterSymbolNotFoundError if symbol is invalid.
        """
        ...

    @abstractmethod
    async def fetch_ohlcv(
        self,
        symbol:   str,
        interval: str = "1h",
        limit:    int = 24,
    ) -> list[OhlcvCandle]:
        """
        Fetch OHLCV candles.
        interval values: "1m", "5m", "15m", "1h", "4h", "1d"
        Returns candles sorted oldest-first.
        """
        ...

    # ------------------------------------------------------------------
    # Account data (requires credentials in live mode)
    # ------------------------------------------------------------------

    @abstractmethod
    async def fetch_balance(self) -> list[Balance]:
        """
        Fetch account balances.
        Paper mode: reads from the paper ledger (PostgreSQL).
        Live mode: reads from exchange API.
        Returns empty list on zero balances (never raises on empty).
        """
        ...

    @abstractmethod
    async def fetch_positions(self) -> list[Position]:
        """
        Fetch open positions.
        Paper mode: queries execution_intent table for FILLED intents
                    with no matching close.
        Live mode: queries exchange positions API.
        Returns empty list when no open positions.
        """
        ...

    # ------------------------------------------------------------------
    # Order management
    # ------------------------------------------------------------------

    @abstractmethod
    async def create_order(
        self,
        symbol:     str,
        side:       str,
        order_type: str,
        quantity:   Decimal,
        price:      Optional[Decimal] = None,
    ) -> Order:
        """
        Submit an order.
        Paper mode: simulates a fill at current market price, writes to
                    the paper ledger. Returns Order with status FILLED.
        Live mode: submits to exchange REST API. Returns Order with
                   status PENDING until confirmed.

        Raises AdapterOrderError if rejected at exchange level.
        Raises AdapterAuthError if credentials are invalid.
        """
        ...

    @abstractmethod
    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        """
        Cancel an open order.
        Returns the Order with updated status=CANCELLED.
        Raises AdapterOrderError if the order cannot be cancelled.
        """
        ...

    @abstractmethod
    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        """
        Fetch the current state of an order by ID.
        Raises AdapterOrderError if order is not found.
        """
        ...

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    @abstractmethod
    async def exchange_status(self) -> ExchangeStatus:
        """
        Return the current connectivity and data-source status.
        Must never raise — return a status with connected=False and
        an error message instead.
        """
        ...

    # ------------------------------------------------------------------
    # Shared helpers (available to all subclasses)
    # ------------------------------------------------------------------

    def _assert_live_credentials(self) -> None:
        """Raise AdapterAuthError if credentials are missing in live mode."""
        if not self.paper and (not self.api_key or not self.api_secret):
            raise AdapterAuthError(
                f"{self.exchange_name}: API key and secret are required in live mode."
            )

    def _normalize_symbol(self, symbol: str) -> str:
        """Strip whitespace and upper-case the symbol."""
        return symbol.strip().upper()
