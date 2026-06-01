# backend/adapters/exchanges/coinbase.py
"""
Coinbase exchange adapter — public market data only.

Uses the Coinbase Advanced Trade REST API (v3) for public ticker and OHLCV data.
No authenticated endpoints are enabled. Live order execution raises NotImplementedError.

Endpoint base: https://api.coinbase.com/api/v3/brokerage (public product data)
Public data does not require credentials.

Rate limits: Coinbase allows 10 req/s public. We stay well within limits.
"""

from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal
from typing import Optional

import httpx

from backend.adapters.exchanges.base import (
    AdapterError,
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
from backend.adapters.exchanges.retry import CircuitBreaker, with_retry

log = logging.getLogger(__name__)

_BASE_URL = "https://api.coinbase.com/api/v3/brokerage"
_TIMEOUT = 10.0

# Coinbase uses product_id format: BTC-USD, ETH-USD
# Map from our internal USDT format where needed
_SYMBOL_MAP: dict[str, str] = {
    "BTCUSDT": "BTC-USDT",
    "ETHUSDT": "ETH-USDT",
    "SOLUSDT": "SOL-USDT",
    "BNBUSDT": "BNB-USDT",
    "ADAUSDT": "ADA-USDT",
    "XRPUSDT": "XRP-USDT",
    "DOGEUSDT": "DOGE-USDT",
    "AVAXUSDT": "AVAX-USDT",
    "DOTUSDT": "DOT-USDT",
    "MATICUSDT": "MATIC-USDT",
}

_INTERVAL_MAP: dict[str, str] = {
    "1m": "ONE_MINUTE",
    "5m": "FIVE_MINUTE",
    "15m": "FIFTEEN_MINUTE",
    "1h": "ONE_HOUR",
    "4h": "FOUR_HOUR",
    "1d": "ONE_DAY",
}


def _to_coinbase_symbol(symbol: str) -> str:
    mapped = _SYMBOL_MAP.get(symbol.upper())
    if mapped:
        return mapped
    # Generic fallback: BTCUSDT -> BTC-USDT
    if symbol.endswith("USDT"):
        base = symbol[:-4]
        return f"{base}-USDT"
    return symbol.replace("/", "-")


class CoinbaseAdapter(BaseExchangeAdapter):
    """
    Coinbase Advanced Trade public market data adapter.

    Public endpoints only — no authentication required, no order placement.
    Live order execution raises NotImplementedError.
    """

    def __init__(self, timeout: float = _TIMEOUT) -> None:
        self._timeout = timeout
        self._circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60,
            name="coinbase",
        )
        self._last_tick_ts: Optional[float] = None
        self._client = httpx.AsyncClient(
            base_url=_BASE_URL,
            timeout=self._timeout,
            headers={"Content-Type": "application/json"},
        )

    @property
    def name(self) -> str:
        return "coinbase"

    @property
    def network(self) -> str:
        return "paper"

    async def exchange_status(self) -> ExchangeStatus:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.get(f"{_BASE_URL}/products/BTC-USDT")
            connected = r.status_code == 200
            stale = (
                self._last_tick_ts is None
                or (time.time() - self._last_tick_ts) > 60
            )
            return ExchangeStatus(
                connected=connected,
                mode="paper",
                exchange_name="coinbase",
                market_data_available=connected,
                market_data_mode="live_public_paper",
                connection_state="connected" if connected else "offline",
                fallback_active=False,
                stale=stale,
                source="coinbase-public",
                error=None if connected else f"HTTP {r.status_code}",
            )
        except Exception as exc:
            return ExchangeStatus(
                connected=False,
                mode="paper",
                exchange_name="coinbase",
                market_data_available=False,
                market_data_mode="live_public_paper",
                connection_state="offline",
                fallback_active=False,
                stale=True,
                source="coinbase-public",
                error=str(exc),
            )

    @with_retry(max_attempts=3, base_delay=0.5)
    async def fetch_ticker(self, symbol: str) -> Ticker:
        cb_symbol = _to_coinbase_symbol(symbol)
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.get(f"{_BASE_URL}/products/{cb_symbol}")
            if r.status_code == 429:
                raise AdapterRateLimitError("coinbase", "Rate limited")
            if r.status_code == 404:
                raise AdapterSymbolNotFoundError("coinbase", symbol)
            if r.status_code != 200:
                raise AdapterUnavailableError("coinbase", f"HTTP {r.status_code}")
            data = r.json()
            price_str = data.get("price") or data.get("mid_market_price", "0")
            price = Decimal(str(price_str)) if price_str else Decimal("0")
            self._last_tick_ts = time.time()
            bid = Decimal(str(data.get("bid", price_str or "0")))
            ask = Decimal(str(data.get("ask", price_str or "0")))
            spread = ask - bid if ask > bid else Decimal("0")
            return Ticker(
                symbol=symbol,
                price=price,
                bid=bid,
                ask=ask,
                spread=spread,
                change24h=float(data.get("price_percentage_change_24h", 0.0)),
                volume24h=Decimal(str(data.get("volume_24h", "0"))),
                timestamp=int(self._last_tick_ts),
            )
        except (AdapterRateLimitError, AdapterSymbolNotFoundError, AdapterUnavailableError):
            raise
        except httpx.TimeoutException as exc:
            raise AdapterUnavailableError("coinbase", f"Timeout: {exc}") from exc
        except Exception as exc:
            raise AdapterError("coinbase", str(exc)) from exc

    @with_retry(max_attempts=3, base_delay=0.5)
    async def fetch_ohlcv(
        self,
        symbol: str,
        interval: str = "1h",
        limit: int = 200,
    ) -> list[OhlcvCandle]:
        cb_symbol = _to_coinbase_symbol(symbol)
        granularity = _INTERVAL_MAP.get(interval, "ONE_HOUR")
        # Coinbase OHLCV endpoint: GET /products/{product_id}/candles
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.get(
                    f"{_BASE_URL}/products/{cb_symbol}/candles",
                    params={"granularity": granularity, "limit": min(limit, 300)},
                )
            if r.status_code == 429:
                raise AdapterRateLimitError("coinbase", "Rate limited")
            if r.status_code == 404:
                raise AdapterSymbolNotFoundError("coinbase", symbol)
            if r.status_code != 200:
                raise AdapterUnavailableError("coinbase", f"HTTP {r.status_code}")
            data = r.json()
            candles_raw = data.get("candles", [])
            candles = []
            for c in candles_raw:
                candles.append(
                    OhlcvCandle(
                        time=int(float(c.get("start", 0))),
                        open=Decimal(str(c.get("open", 0))),
                        high=Decimal(str(c.get("high", 0))),
                        low=Decimal(str(c.get("low", 0))),
                        close=Decimal(str(c.get("close", 0))),
                        volume=Decimal(str(c.get("volume", 0))),
                    )
                )
            # Coinbase returns newest-first; sort oldest-first
            candles.sort(key=lambda x: x.time)
            return candles[-limit:]
        except (AdapterRateLimitError, AdapterSymbolNotFoundError, AdapterUnavailableError):
            raise
        except httpx.TimeoutException as exc:
            raise AdapterUnavailableError("coinbase", f"Timeout: {exc}") from exc
        except Exception as exc:
            raise AdapterError("coinbase", str(exc)) from exc

    # ------------------------------------------------------------------
    # Account / execution methods — all disabled (paper-only mode)
    # ------------------------------------------------------------------

    async def fetch_balance(self) -> list[Balance]:
        raise NotImplementedError(
            "Coinbase authenticated endpoints are disabled. Use PaperPortfolio for balances."
        )

    async def fetch_positions(self) -> list[Position]:
        raise NotImplementedError(
            "Coinbase authenticated endpoints are disabled. Use PaperPortfolio for positions."
        )

    async def create_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        quantity: Decimal,
        price: Optional[Decimal] = None,
    ) -> Order:
        raise NotImplementedError(
            "Coinbase live order execution is disabled. All execution routes through PaperAdapter."
        )

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        raise NotImplementedError(
            "Coinbase live order execution is disabled."
        )

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        raise NotImplementedError(
            "Coinbase live order execution is disabled."
        )

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass
