# backend/adapters/exchanges/live.py
"""
Live adapter — permanently disabled.

Every method raises NotImplementedError. Live order execution is NOT
supported in this project. This file exists to make the "no live path"
guarantee explicit, testable, and auditable.

Do not implement any method here. Ever.
"""

from __future__ import annotations

from decimal import Decimal
from typing import AsyncIterator, Optional

from backend.adapters.exchanges.base import (
    Balance,
    BaseExchangeAdapter,
    ExchangeStatus,
    OhlcvCandle,
    Order,
    Position,
    Ticker,
)


_DISABLED_MSG = (
    "Live order execution is permanently disabled in this deployment. "
    "LiveAdapter cannot place, cancel, or query real orders. "
    "All execution is routed through PaperAdapter."
)


class LiveAdapter(BaseExchangeAdapter):
    """Permanently disabled live execution adapter."""

    @property
    def name(self) -> str:  # type: ignore[override]
        raise NotImplementedError(_DISABLED_MSG)

    @property
    def network(self) -> str:  # type: ignore[override]
        raise NotImplementedError(_DISABLED_MSG)

    async def exchange_status(self) -> ExchangeStatus:
        raise NotImplementedError(_DISABLED_MSG)

    async def fetch_ticker(self, symbol: str) -> Ticker:
        raise NotImplementedError(_DISABLED_MSG)

    async def fetch_ohlcv(
        self,
        symbol: str,
        interval: str = "1h",
        limit: int = 200,
    ) -> list[OhlcvCandle]:
        raise NotImplementedError(_DISABLED_MSG)

    async def fetch_balance(self) -> list[Balance]:
        raise NotImplementedError(_DISABLED_MSG)

    async def fetch_positions(self) -> list[Position]:
        raise NotImplementedError(_DISABLED_MSG)

    async def create_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        quantity: Decimal,
        price: Optional[Decimal] = None,
    ) -> Order:
        raise NotImplementedError(_DISABLED_MSG)

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        raise NotImplementedError(_DISABLED_MSG)

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        raise NotImplementedError(_DISABLED_MSG)
