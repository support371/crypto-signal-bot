# backend/logic/coingecko_market_data.py
"""
CoinGecko public market data service.

Uses the free CoinGecko /simple/price endpoint — no API key required,
no geo-restrictions. Falls back to this when Binance returns HTTP 451
(geo-blocked) on the host's region (e.g. Render US/EU nodes hitting
Binance's compliance block).

Rate limit: 50 req/min on the free tier. We poll all 10 symbols in a
single batch request every 15s — well within limits.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Awaitable, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Symbol → CoinGecko coin ID
_SYMBOL_TO_GECKO: Dict[str, str] = {
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
_GECKO_TO_SYMBOL: Dict[str, str] = {v: k for k, v in _SYMBOL_TO_GECKO.items()}

_BASE_URL = "https://api.coingecko.com/api/v3"
_POLL_INTERVAL = 15.0  # seconds


class CoinGeckoMarketDataService:
    """
    Polls CoinGecko every 15s for real-time prices.
    Implements the same interface as BinancePublicMarketDataService so it
    can be used as a drop-in replacement.
    """

    def __init__(
        self,
        symbols: List[str],
        on_market_update: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        on_status_change: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    ) -> None:
        self._symbols = [s.upper() for s in symbols if s.upper() in _SYMBOL_TO_GECKO]
        self._on_market_update = on_market_update
        self._on_status_change = on_status_change
        self._snapshots: Dict[str, Dict[str, Any]] = {}
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._connected = False
        self._last_error: Optional[str] = None
        self._last_update_ts: Optional[float] = None
        self._client: Optional[httpx.AsyncClient] = None

    # ------------------------------------------------------------------
    # Public interface (matches BinancePublicMarketDataService)
    # ------------------------------------------------------------------

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._client = httpx.AsyncClient(timeout=10.0)
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("CoinGeckoMarketDataService started for %d symbols", len(self._symbols))

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._client:
            await self._client.aclose()
        logger.info("CoinGeckoMarketDataService stopped")

    def get_snapshot(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self._snapshots.get(symbol.upper())

    def get_status(self) -> Dict[str, Any]:
        return {
            "exchange": "coingecko",
            "market_data_mode": "live_public_paper",
            "connected": self._connected,
            "connection_state": "connected" if self._connected else ("polling" if self._running else "offline"),
            "fallback_active": False,
            "stale": self._last_update_ts is None or (time.time() - self._last_update_ts) > 60,
            "last_update_ts": self._last_update_ts,
            "last_error": self._last_error,
            "symbols": list(self._snapshots.keys()),
            "source": "coingecko-rest",
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _poll_loop(self) -> None:
        """Poll CoinGecko every 15s in a tight loop."""
        while self._running:
            try:
                await self._fetch_all()
            except Exception as exc:
                self._last_error = str(exc)
                self._connected = False
                logger.warning("CoinGecko poll error: %s", exc)
            await asyncio.sleep(_POLL_INTERVAL)

    async def _fetch_all(self) -> None:
        gecko_ids = [_SYMBOL_TO_GECKO[s] for s in self._symbols]
        ids_param = ",".join(gecko_ids)

        resp = await self._client.get(
            f"{_BASE_URL}/simple/price",
            params={
                "ids": ids_param,
                "vs_currencies": "usd",
                "include_24hr_change": "true",
                "include_24hr_vol": "true",
            },
        )
        if resp.status_code == 429:
            raise RuntimeError("CoinGecko rate limit exceeded")
        if not resp.is_success:
            raise RuntimeError(f"CoinGecko HTTP {resp.status_code}")

        data: Dict[str, Any] = resp.json()
        now = time.time()

        for gecko_id, values in data.items():
            symbol = _GECKO_TO_SYMBOL.get(gecko_id)
            if not symbol:
                continue

            price      = float(values.get("usd", 0))
            change24h  = float(values.get("usd_24h_change", 0))
            volume24h  = float(values.get("usd_24h_vol", 0))

            snap: Dict[str, Any] = {
                "symbol":    symbol,
                "price":     price,
                "change24h": round(change24h, 4),
                "volume24h": round(volume24h, 2),
                "marketCap": 0.0,      # not included in free simple/price
                "timestamp": now,
                "source":    "coingecko-rest",
                "exchange":  "coingecko",
            }
            self._snapshots[symbol] = snap

            if self._on_market_update:
                try:
                    await self._on_market_update(snap)
                except Exception as cb_exc:
                    logger.warning("on_market_update callback error: %s", cb_exc)

        self._connected = True
        self._last_error = None
        self._last_update_ts = now
        logger.debug("CoinGecko poll OK — %d symbols updated", len(data))
