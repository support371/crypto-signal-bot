# backend/adapters/exchanges/coingecko.py
"""
CoinGecko exchange adapter — public market data only, no execution.

Used as the primary market data adapter in paper mode when Binance is
geo-blocked (HTTP 451) on the host's server region (e.g. Render US/EU).

CoinGecko free tier: 50 req/min.
We use a module-level shared cache (TTL=15s) so ALL callers — market data
service, guardian, price endpoint — share a single batch response and never
exceed ~4 req/min.
"""
from __future__ import annotations

import asyncio
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

_BASE_URL  = "https://api.coingecko.com/api/v3"
_CACHE_TTL = 15.0   # seconds — refresh at most once every 15s

# USDT-quoted symbol → CoinGecko coin ID
_SYMBOL_MAP: Dict[str, str] = {
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
_GECKO_TO_SYMBOL: Dict[str, str] = {v: k for k, v in _SYMBOL_MAP.items()}

# ---------------------------------------------------------------------------
# Module-level shared cache — all CoinGeckoAdapter instances share this
# so we hit the API at most once per _CACHE_TTL seconds
# ---------------------------------------------------------------------------
_cache_data:       Dict[str, dict]    = {}   # gecko_id → raw price payload
_cache_ts:         float               = 0.0
_cache_last_error: Optional[str]      = None
_shared_client:    Optional[httpx.AsyncClient] = None

# Lock is created lazily per event-loop to survive hot-reloads and test isolation
_cache_lock:      asyncio.Lock | None = None
_cache_lock_loop: object | None       = None   # loop the lock was created for


def _get_lock() -> asyncio.Lock:
    global _cache_lock, _cache_lock_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    # Re-create the lock if the event loop changed (new Render deploy / test isolation)
    if _cache_lock is None or _cache_lock_loop is not loop:
        _cache_lock      = asyncio.Lock()
        _cache_lock_loop = loop
    return _cache_lock


def _get_shared_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(timeout=10.0)
    return _shared_client


async def _fetch_all_cached(client: Optional[httpx.AsyncClient] = None) -> Tuple[Dict[str, dict], Optional[str]]:
    """Return shared cached price data, refreshing if stale.
    Uses a module-level singleton client — all callers share one connection pool.
    The optional `client` arg is ignored (kept for backward compat).
    """
    global _cache_data, _cache_ts, _cache_last_error
    _client_to_use = _get_shared_client()

    async with _get_lock():
        if time.time() - _cache_ts < _CACHE_TTL and _cache_data:
            return _cache_data, None

        # Need a refresh
        ids = ",".join(_SYMBOL_MAP.values())
        try:
            resp = await _client_to_use.get(
                f"{_BASE_URL}/simple/price",
                params={
                    "ids": ids,
                    "vs_currencies": "usd",
                    "include_24hr_change": "true",
                    "include_24hr_vol": "true",
                },
            )
            if resp.status_code == 429:
                _cache_last_error = "CoinGecko rate limit (429) — using cached data"
                # Return stale cache rather than raising
                return _cache_data, _cache_last_error
            if not resp.is_success:
                _cache_last_error = f"CoinGecko HTTP {resp.status_code}"
                return _cache_data, _cache_last_error

            _cache_data      = resp.json()
            _cache_ts        = time.time()
            _cache_last_error = None
        except Exception as exc:
            _cache_last_error = str(exc)
            # Return stale cache on transient errors
            return _cache_data, _cache_last_error

    return _cache_data, None


class CoinGeckoAdapter(BaseExchangeAdapter):
    """
    Read-only adapter backed by CoinGecko public REST.
    Uses a shared module-level cache to stay well within the 50 req/min limit.
    Execution methods raise AdapterUnavailableError.
    """

    exchange_name = "coingecko"

    def __init__(self, *, paper: bool = True, **kwargs: object) -> None:
        super().__init__(api_key=None, api_secret=None, paper=paper)
        self._http: Optional[httpx.AsyncClient] = None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=10.0)
        return self._http

    def _gecko_id(self, symbol: str) -> str:
        key = symbol.upper().replace("-", "")
        gecko_id = _SYMBOL_MAP.get(key)
        if not gecko_id:
            raise AdapterError(f"CoinGecko: unsupported symbol '{symbol}'")
        return gecko_id

    # ------------------------------------------------------------------
    # fetch_ticker — shared cache, no extra HTTP calls
    # ------------------------------------------------------------------

    async def fetch_ticker(self, symbol: str) -> Ticker:
        gecko_id = self._gecko_id(symbol)
        data, err = await _fetch_all_cached()

        entry = data.get(gecko_id)
        if not entry:
            if err:
                raise AdapterError(f"CoinGecko unavailable: {err}")
            raise AdapterError(f"CoinGecko: no data for '{symbol}'")

        price     = float(entry.get("usd",            0))
        change24h = float(entry.get("usd_24h_change", 0))
        volume24h = float(entry.get("usd_24h_vol",    0))

        spread_val = Decimal(str(price * 0.0005))
        price_dec = Decimal(str(price))
        bid_dec = price_dec - spread_val
        ask_dec = price_dec + spread_val

        return Ticker(
            symbol=symbol.upper(),
            price=price_dec,
            bid=bid_dec,
            ask=ask_dec,
            spread=spread_val * 2,
            change24h=float(change24h),
            volume24h=Decimal(str(round(volume24h, 2))),
            timestamp=int(time.time()),
        )

    # ------------------------------------------------------------------
    # fetch_ohlcv — synthetic single candle (CoinGecko free has no OHLCV)
    # ------------------------------------------------------------------

    async def fetch_ohlcv(
        self,
        symbol:   str,
        interval: str = "1h",
        limit:    int = 50,
    ) -> List[OhlcvCandle]:
        ticker = await self.fetch_ticker(symbol)
        price  = float(ticker.price)
        now    = int(time.time())
        candle = OhlcvCandle(
            time=now,
            open=Decimal(str(price)),
            high=Decimal(str(price * 1.001)),
            low=Decimal(str(price * 0.999)),
            close=Decimal(str(price)),
            volume=ticker.volume24h,
        )
        return [candle] * min(limit, 50)

    # ------------------------------------------------------------------
    # exchange_status — uses the same shared cache (no extra HTTP req)
    # ------------------------------------------------------------------

    async def exchange_status(self) -> ExchangeStatus:
        try:
            data, err = await _fetch_all_cached()
            # connected=True if we have price data, even if last refresh hit 429
            # (stale cache is still usable market data)
            has_data   = bool(data)
            hard_fail  = err is not None and not has_data
            connected  = has_data
            conn_state = "connected" if (has_data and not err) else ("degraded" if has_data else "offline")
            return ExchangeStatus(
                connected=connected,
                mode="paper",
                exchange_name=self.exchange_name,
                market_data_available=connected,
                market_data_mode="live_public_paper" if connected else "unavailable",
                connection_state=conn_state,
                fallback_active=False,
                stale=not connected,
                source="https://api.coingecko.com",
                error=err if hard_fail else None,
            )
        except Exception as exc:
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
    # Execution stubs — not supported
    # ------------------------------------------------------------------

    async def fetch_balance(self) -> List[Balance]:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed")

    async def fetch_positions(self) -> List[Position]:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed")

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
        raise AdapterUnavailableError("CoinGecko is a read-only price feed")

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed")

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        raise AdapterUnavailableError("CoinGecko is a read-only price feed")

async def warm_cache() -> None:
    """Pre-populate the shared price cache at startup.
    Call once from app lifespan so all signal evaluations hit the cache, not the network."""
    data, err = await _fetch_all_cached()
    if err:
        import logging as _log
        _log.getLogger(__name__).warning("CoinGecko warm_cache: %s", err)
    else:
        import logging as _log
        _log.getLogger(__name__).info("CoinGecko cache warmed — %d assets loaded", len(data))
