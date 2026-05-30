# backend/adapters/exchanges/coingecko.py
"""
CoinGecko exchange adapter — public market data only, no execution.

Used as the primary market data adapter in paper mode when Binance is
geo-blocked (HTTP 451) on the host's server region (e.g. Render US/EU).

CoinGecko's /simple/price endpoint:
  - No API key required
  - No geo-restrictions
  - 50 req/min on the free tier
  - Covers all 10 symbols used by this bot
"""
from __future__ import annotations

import asyncio
import time
from decimal import Decimal
from typing import List, Optional, Sequence

import httpx

from backend.adapters.exchanges.base import (
    AdapterError,
    AdapterUnavailableError,
    Balance,
    BaseExchangeAdapter,
    ExchangeStatus,
    OhlcvCandle,
    Order,
    Position,
    Ticker,
)

_BASE_URL = "https://api.coingecko.com/api/v3"

# USDT-quoted symbol → CoinGecko coin ID
_SYMBOL_MAP: dict[str, str] = {
    "BTCUSDT":  "bitcoin",
    "ETHUSDT":  "ethereum",
    "SOLUSDT":  "solana",
    "BNBUSDT":  "binancecoin",
    "ADAUSDT":  "cardano",
    "XRPUSDT":  "ripple",
    "DOGEUSDT": "dogecoin",
    "DOTUSDT":  "polkadot",
    "AVAXUSDT": "avalanche-2",
    "LINKUSDT": "chainlink",
}

# Reverse map: gecko id → symbol
_GECKO_MAP: dict[str, str] = {v: k for k, v in _SYMBOL_MAP.items()}


class CoinGeckoAdapter(BaseExchangeAdapter):
    """
    Read-only adapter backed by CoinGecko public REST.
    Execution methods raise AdapterUnavailableError — CoinGecko is a
    price-feed only, not a trading venue.
    """

    exchange_name = "coingecko"

    def __init__(self, *, paper: bool = True, **kwargs: object) -> None:
        super().__init__(api_key=None, api_secret=None, paper=paper)
        self._http: Optional[httpx.AsyncClient] = None
        self._last_ping: Optional[float] = None
        self._last_error: Optional[str] = None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=10.0)
        return self._http

    async def _get(self, path: str, params: dict | None = None) -> dict:
        resp = await self._client().get(f"{_BASE_URL}{path}", params=params or {})
        if resp.status_code == 429:
            raise AdapterError("CoinGecko rate limit exceeded")
        if not resp.is_success:
            raise AdapterError(f"CoinGecko HTTP {resp.status_code}: {path}")
        return resp.json()

    def _gecko_id(self, symbol: str) -> str:
        key = symbol.upper().replace("-", "")
        gecko_id = _SYMBOL_MAP.get(key)
        if not gecko_id:
            raise AdapterError(f"CoinGecko: unsupported symbol '{symbol}'")
        return gecko_id

    # ------------------------------------------------------------------
    # fetch_ticker — public
    # ------------------------------------------------------------------

    async def fetch_ticker(self, symbol: str) -> Ticker:
        gecko_id = self._gecko_id(symbol)
        data = await self._get(
            "/simple/price",
            params={
                "ids": gecko_id,
                "vs_currencies": "usd",
                "include_24hr_change": "true",
                "include_24hr_vol": "true",
            },
        )
        entry = data.get(gecko_id, {})
        price     = float(entry.get("usd",             0))
        change24h = float(entry.get("usd_24h_change",  0))
        volume24h = float(entry.get("usd_24h_vol",     0))

        # Approximate bid/ask from price (CoinGecko doesn't provide orderbook)
        spread = price * 0.0005
        return Ticker(
            symbol=symbol.upper(),
            bid=Decimal(str(round(price - spread, 8))),
            ask=Decimal(str(round(price + spread, 8))),
            last=Decimal(str(price)),
            volume=Decimal(str(round(volume24h, 2))),
            change_24h=Decimal(str(round(change24h, 6))),
            timestamp=time.time(),
            exchange=self.exchange_name,
        )

    # ------------------------------------------------------------------
    # fetch_ohlcv — approximate from 24h range (best-effort for paper)
    # ------------------------------------------------------------------

    async def fetch_ohlcv(
        self,
        symbol: str,
        interval: str = "1h",
        limit:    int = 50,
    ) -> List[OhlcvCandle]:
        # CoinGecko free tier doesn't expose OHLCV per-minute — return
        # a synthetic single candle from current price to satisfy callers.
        ticker = await self.fetch_ticker(symbol)
        price = float(ticker.last)
        now = time.time()
        candle = OhlcvCandle(
            timestamp=now,
            open=price,
            high=price * 1.001,
            low=price  * 0.999,
            close=price,
            volume=float(ticker.volume),
        )
        return [candle] * min(limit, 50)

    # ------------------------------------------------------------------
    # exchange_status — required, used by guardian
    # ------------------------------------------------------------------

    async def exchange_status(self) -> ExchangeStatus:
        try:
            # Lightweight ping: single coin price check
            await self._get("/simple/price", params={"ids": "bitcoin", "vs_currencies": "usd"})
            self._last_ping  = time.time()
            self._last_error = None
            return ExchangeStatus(
                connected=True,
                mode="paper",
                exchange_name=self.exchange_name,
                market_data_available=True,
                market_data_mode="live_public_paper",
                connection_state="connected",
                fallback_active=False,
                stale=False,
                source="https://api.coingecko.com",
                error=None,
            )
        except Exception as exc:
            self._last_error = str(exc)
            return ExchangeStatus(
                connected=False,
                mode="paper",
                exchange_name=self.exchange_name,
                market_data_available=False,
                market_data_mode="unavailable",
                connection_state="offline",
                fallback_active=False,
                stale=True,
                source="https://api.coingecko.com",
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # Execution methods — not supported (read-only adapter)
    # ------------------------------------------------------------------

    async def fetch_balance(self) -> List[Balance]:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed — no balance info")

    async def fetch_positions(self) -> List[Position]:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed — no positions")

    async def create_order(
        self,
        *,
        symbol:     str,
        side:       str,
        order_type: str,
        quantity:   Decimal,
        price:      Optional[Decimal] = None,
        client_order_id: Optional[str] = None,
    ) -> Order:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed — no order execution")

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed — no order execution")

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed — no order execution")
