# backend/adapters/exchanges/binance.py
"""
PHASE 5 — Binance exchange adapter (paper and live).

Paper mode uses real Binance public market data for price accuracy,
but routes order execution to the paper ledger (Rule 9).

Live mode submits orders to the real Binance REST API.
Set BINANCE_TESTNET=true to use testnet (safe default from settings.py).
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Optional

import httpx

from backend.adapters.exchanges.base import (
    AdapterAuthError,
    AdapterOrderError,
    AdapterRateLimitError,
    AdapterSymbolNotFoundError,
    AdapterUnavailableError,
    Balance,
    BaseExchangeAdapter,
    ExchangeStatus,
    OhlcvCandle,
    Order,
    Position,
    Ticker,
)

_INTERVAL_MAP = {
    "1m": "1m", "5m": "5m", "15m": "15m",
    "1h": "1h", "4h": "4h", "1d": "1d",
}


class BinanceAdapter(BaseExchangeAdapter):
    """
    Binance adapter supporting both paper and live modes.

    Configuration (from backend.config.settings):
        BINANCE_API_KEY, BINANCE_API_SECRET — required for live mode
        BINANCE_TESTNET                     — True by default (safe)
        BINANCE_BASE_URL                    — overridable for testnet
    """

    exchange_name = "binance"

    def __init__(
        self,
        api_key:    Optional[str] = None,
        api_secret: Optional[str] = None,
        paper:      bool = True,
        base_url:   str = "https://api.binance.com",
        testnet:    bool = True,
        **kwargs: object,
    ) -> None:
        super().__init__(api_key=api_key, api_secret=api_secret, paper=paper)
        if not paper and testnet:
            base_url = "https://testnet.binance.vision"
        self._base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=10.0,
                headers={"Accept": "application/json"},
            )
        return self._client

    async def _get_public(self, path: str, params: dict | None = None) -> object:
        client = await self._http()
        try:
            resp = await client.get(path, params=params)
        except httpx.ConnectError as exc:
            raise AdapterUnavailableError(f"Binance unreachable: {exc}") from exc
        if resp.status_code == 429:
            raise AdapterRateLimitError("Binance rate limit exceeded.")
        if resp.status_code == 400:
            data = resp.json()
            msg = data.get("msg", str(data))
            if "-1121" in str(data):
                raise AdapterSymbolNotFoundError(f"Binance: invalid symbol — {msg}")
            raise AdapterOrderError(f"Binance bad request: {msg}")
        if not resp.is_success:
            raise AdapterUnavailableError(f"Binance HTTP {resp.status_code}")
        return resp.json()

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    async def fetch_ticker(self, symbol: str) -> Ticker:
        symbol = self._normalize_symbol(symbol)
        data = await self._get_public("/api/v3/ticker/bookTicker", {"symbol": symbol})
        assert isinstance(data, dict)
        # Enrich with 24h stats
        stats = await self._get_public("/api/v3/ticker/24hr", {"symbol": symbol})
        assert isinstance(stats, dict)
        price = Decimal(str(stats["lastPrice"]))
        bid   = Decimal(str(data["bidPrice"]))
        ask   = Decimal(str(data["askPrice"]))
        return Ticker(
            symbol=symbol,
            price=price,
            bid=bid,
            ask=ask,
            spread=ask - bid,
            change24h=float(stats.get("priceChangePercent", 0)),
            volume24h=Decimal(str(stats.get("volume", 0))),
            timestamp=int(time.time()),
        )

    async def fetch_ohlcv(
        self,
        symbol:   str,
        interval: str = "1h",
        limit:    int = 24,
    ) -> list[OhlcvCandle]:
        symbol   = self._normalize_symbol(symbol)
        interval = _INTERVAL_MAP.get(interval, "1h")
        data = await self._get_public(
            "/api/v3/klines",
            {"symbol": symbol, "interval": interval, "limit": limit},
        )
        assert isinstance(data, list)
        return [
            OhlcvCandle(
                time=int(candle[0]) // 1000,  # ms → seconds
                open=Decimal(str(candle[1])),
                high=Decimal(str(candle[2])),
                low=Decimal(str(candle[3])),
                close=Decimal(str(candle[4])),
                volume=Decimal(str(candle[5])),
            )
            for candle in data
        ]

    # ------------------------------------------------------------------
    # Account — paper mode reads from paper ledger; live reads Binance
    # ------------------------------------------------------------------

    async def fetch_balance(self) -> list[Balance]:
        if self.paper:
            # Paper mode: caller injects paper ledger dependency
            # Return empty — paper balance is owned by the reconciliation service
            return []
        self._assert_live_credentials()
        raise NotImplementedError(
            "Live Binance balance requires signed request implementation. "
            "Wire in the signed HTTP helper and implement here."
        )

    async def fetch_positions(self) -> list[Position]:
        if self.paper:
            return []  # Paper positions owned by reconciliation service
        self._assert_live_credentials()
        raise NotImplementedError("Live Binance positions require signed request.")

    # ------------------------------------------------------------------
    # Order management
    # ------------------------------------------------------------------

    async def create_order(
        self,
        symbol:     str,
        side:       str,
        order_type: str,
        quantity:   Decimal,
        price:      Optional[Decimal] = None,
    ) -> Order:
        symbol = self._normalize_symbol(symbol)
        now    = int(time.time())

        if self.paper:
            # Paper mode: get current price and simulate an immediate fill
            ticker = await self.fetch_ticker(symbol)
            fill_price = ticker.price if order_type == "MARKET" else (price or ticker.price)
            return Order(
                id=f"paper-binance-{now}",
                symbol=symbol,
                side=side.upper(),
                order_type=order_type.upper(),
                quantity=quantity,
                price=price,
                fill_price=fill_price,
                filled_qty=quantity,
                status="FILLED",
                created_at=now,
                updated_at=now,
                exchange_order_id=None,
            )

        self._assert_live_credentials()
        raise NotImplementedError("Live Binance order requires signed POST /api/v3/order.")

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        if self.paper:
            now = int(time.time())
            return Order(
                id=order_id,
                symbol=self._normalize_symbol(symbol),
                side="BUY",  # unknown at cancel time in paper mode
                order_type="MARKET",
                quantity=Decimal("0"),
                price=None,
                fill_price=None,
                status="CANCELLED",
                created_at=now,
                updated_at=now,
            )
        self._assert_live_credentials()
        raise NotImplementedError("Live Binance cancel requires signed DELETE /api/v3/order.")

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        self._assert_live_credentials()
        raise NotImplementedError("Live Binance fetch_order requires signed GET /api/v3/order.")

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    async def exchange_status(self) -> ExchangeStatus:
        try:
            await self._get_public("/api/v3/ping")
            connected = True
            error = None
        except Exception as exc:
            connected = False
            error = str(exc)

        return ExchangeStatus(
            connected=connected,
            mode="paper" if self.paper else "live",
            exchange_name=self.exchange_name,
            market_data_available=connected,
            market_data_mode="live_public_paper" if self.paper else "live",
            connection_state="connected" if connected else "offline",
            fallback_active=False,
            stale=False,
            source=self._base_url,
            error=error,
        )
