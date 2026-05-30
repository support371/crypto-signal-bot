# backend/adapters/exchanges/binance_us_ohlcv.py
"""
Binance.US public OHLCV adapter — candle data only, no auth required.

Uses api.binance.us/api/v3/klines which is accessible from Render's
US infrastructure even when api.binance.com is geo-blocked (HTTP 451).

This adapter is intentionally narrow: only fetch_ohlcv is implemented.
All execution and balance methods raise AdapterUnavailableError.
Ticker/price is still handled by CoinGecko.

Rate limits: Binance.US allows 1200 req/min (weight-based).
A single klines request costs 1 weight. With 10 symbols × 1 req/60s
we use ~10 weight/min — well within limits.
"""
from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

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

log = logging.getLogger(__name__)

_BASE_URL = "https://api.binance.us/api/v3"

# Interval string normalisation: signal service uses "1h"
_INTERVAL_MAP: Dict[str, str] = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h", "8h": "8h", "12h": "12h",
    "1d": "1d", "3d": "3d", "1w": "1w", "1M": "1M",
}

# Shared HTTP client — one connection pool for all instances
_shared_client: Optional[httpx.AsyncClient] = None
_client_lock:   Optional[asyncio.Lock]       = None


def _get_lock() -> asyncio.Lock:
    global _client_lock
    if _client_lock is None:
        _client_lock = asyncio.Lock()
    return _client_lock


def _get_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "crypto-signal-bot/1.0"},
        )
    return _shared_client


def _parse_klines(raw: list) -> List[OhlcvCandle]:
    """Convert Binance klines format → OhlcvCandle list."""
    candles = []
    for row in raw:
        # row: [open_ts_ms, open, high, low, close, volume, close_ts, ...]
        candles.append(OhlcvCandle(
            time=int(float(row[0]) / 1000.0),  # ms → unix seconds
            open=Decimal(str(row[1])),
            high=Decimal(str(row[2])),
            low=Decimal(str(row[3])),
            close=Decimal(str(row[4])),
            volume=Decimal(str(row[5])),
        ))
    return candles


class BinanceUsOhlcvAdapter(BaseExchangeAdapter):
    """
    Candle-only adapter using the Binance.US public klines endpoint.
    No API key required.
    """

    exchange_name = "binance_us_ohlcv"

    def __init__(self, *, paper: bool = True, **kwargs: object) -> None:
        super().__init__(api_key=None, api_secret=None, paper=paper)

    # ------------------------------------------------------------------
    # fetch_ohlcv — the only implemented method
    # ------------------------------------------------------------------

    async def fetch_ohlcv(
        self,
        symbol:   str,
        interval: str = "1h",
        limit:    int = 220,
    ) -> List[OhlcvCandle]:
        """
        Fetch up to `limit` OHLCV candles for `symbol` from Binance.US.
        Returns an empty list on any error so callers can fall back gracefully.
        """
        sym = symbol.upper().replace("-", "")
        iv  = _INTERVAL_MAP.get(interval, interval)
        # Binance max per request is 1000
        limit = min(limit, 1000)

        url    = f"{_BASE_URL}/klines"
        params = {"symbol": sym, "interval": iv, "limit": limit}

        client = _get_client()
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 451:
                log.debug("[binance_us_ohlcv] 451 geo-block on %s — skipping", sym)
                return []
            if resp.status_code == 429:
                log.warning("[binance_us_ohlcv] rate limited on %s", sym)
                return []
            if not resp.is_success:
                log.warning("[binance_us_ohlcv] HTTP %d for %s", resp.status_code, sym)
                return []

            raw = resp.json()
            if not isinstance(raw, list):
                # Error response from Binance.US (e.g. invalid symbol)
                log.warning("[binance_us_ohlcv] unexpected response for %s: %s",
                            sym, str(raw)[:120])
                return []

            candles = _parse_klines(raw)
            log.debug("[binance_us_ohlcv] %s: fetched %d candles", sym, len(candles))
            return candles

        except httpx.TimeoutException:
            log.warning("[binance_us_ohlcv] timeout fetching %s", sym)
            return []
        except Exception as exc:
            log.warning("[binance_us_ohlcv] error fetching %s: %s", sym, exc)
            return []

    # ------------------------------------------------------------------
    # exchange_status — lightweight reachability check (no auth needed)
    # ------------------------------------------------------------------

    async def exchange_status(self) -> ExchangeStatus:
        try:
            client = _get_client()
            resp   = await client.get(f"{_BASE_URL}/time", timeout=5.0)
            ok     = resp.is_success
            return ExchangeStatus(
                connected=ok,
                mode="paper",
                exchange_name=self.exchange_name,
                market_data_available=ok,
                market_data_mode="live_ohlcv" if ok else "unavailable",
                connection_state="connected" if ok else "offline",
                fallback_active=False,
                stale=not ok,
                source=_BASE_URL,
                error=None if ok else f"HTTP {resp.status_code}",
            )
        except Exception as exc:
            return ExchangeStatus(
                connected=False, mode="paper",
                exchange_name=self.exchange_name,
                market_data_available=False,
                market_data_mode="unavailable",
                connection_state="offline",
                fallback_active=False, stale=True,
                source=_BASE_URL, error=str(exc),
            )

    # ------------------------------------------------------------------
    # Unsupported stubs
    # ------------------------------------------------------------------

    async def fetch_ticker(self, symbol: str) -> Ticker:
        raise AdapterUnavailableError("BinanceUsOhlcvAdapter: no ticker support — use CoinGecko")

    async def fetch_balance(self) -> List[Balance]:
        raise AdapterUnavailableError("BinanceUsOhlcvAdapter: read-only OHLCV adapter")

    async def fetch_positions(self) -> List[Position]:
        raise AdapterUnavailableError("BinanceUsOhlcvAdapter: read-only OHLCV adapter")

    async def create_order(self, *, symbol, side, order_type, quantity,
                           price=None, client_order_id=None) -> Order:
        raise AdapterUnavailableError("BinanceUsOhlcvAdapter: read-only OHLCV adapter")

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        raise AdapterUnavailableError("BinanceUsOhlcvAdapter: read-only OHLCV adapter")

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        raise AdapterUnavailableError("BinanceUsOhlcvAdapter: read-only OHLCV adapter")
