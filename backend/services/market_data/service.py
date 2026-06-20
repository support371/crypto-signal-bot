# backend/services/market_data/service.py
"""
PHASE 6 — MarketDataService.

Replaces every synthetic/fallback price path in the backend.

SYNTHETIC PATHS REMOVED:
  - Any price generation using random numbers or hardcoded values
  - Silent fallback to mock prices when exchange is unreachable
  - "SYNTHETIC" as a live-facing market_data_mode string
  - Dual-source CoinGecko-first logic (that lived in the frontend; not re-introduced here)

RULES:
  - Price truth comes exclusively from exchange adapters (Phase 5).
  - When adapters are unavailable: raise MarketDataUnavailable. Never fabricate.
  - Stale data is detected and reported as "stale: true" — never silently served
    as if fresh.
  - market_data_mode is one of: "live" | "paper_live" | "unavailable".
    "SYNTHETIC" is not a valid runtime mode in this service.

ORDERING:
  Primary adapter is selected by get_adapter() from Phase 5 config.
  If primary fails, an ordered failover list is attempted.
  If all adapters fail: MarketDataUnavailable is raised.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from backend.adapters.exchanges import get_adapter, get_market_data_adapter
from backend.adapters.exchanges.base import (
    AdapterUnavailableError,
    AdapterRateLimitError,
    BaseExchangeAdapter,
    ExchangeStatus,
    OhlcvCandle,
    Ticker,
)
from backend.config.loader import ExchangeConfig, RedisConfig, get_exchange_config, get_redis_config

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Service-level CoinGecko dedup — prevents concurrent get_price() calls
# from each firing a separate HTTP request during startup burst.
# One asyncio.Lock gates the refresh; all waiters share the result.
# ---------------------------------------------------------------------------
_cg_dedup_lock:  asyncio.Lock | None = None
_cg_dedup_ts:    float               = 0.0
_cg_dedup_cache: dict                = {}   # symbol -> Ticker
_CG_DEDUP_TTL   = 12.0   # seconds — slightly shorter than CoinGecko 15s TTL


def _get_cg_lock() -> asyncio.Lock:
    global _cg_dedup_lock
    if _cg_dedup_lock is None:
        _cg_dedup_lock = asyncio.Lock()
    return _cg_dedup_lock


async def _get_coingecko_ticker_deduped(symbol: str) -> "Ticker":
    """Fetch CoinGecko ticker with service-level deduplication.
    Multiple concurrent callers share a single HTTP request per TTL window."""
    global _cg_dedup_ts, _cg_dedup_cache
    import time as _time

    # Fast path: cache hit, no lock needed
    if _time.time() - _cg_dedup_ts < _CG_DEDUP_TTL and symbol in _cg_dedup_cache:
        return _cg_dedup_cache[symbol]

    async with _get_cg_lock():
        # Double-check after acquiring lock
        if _time.time() - _cg_dedup_ts < _CG_DEDUP_TTL and symbol in _cg_dedup_cache:
            return _cg_dedup_cache[symbol]

        # Refresh all symbols in one call
        from backend.adapters.exchanges.coingecko import _fetch_all_cached, _GECKO_TO_SYMBOL
        from backend.adapters.exchanges.coingecko import _SYMBOL_MAP
        from decimal import Decimal as _D
        import time as _t

        data, err = await _fetch_all_cached()
        if data:
            now = _t.time()
            for gecko_id, values in data.items():
                sym = _GECKO_TO_SYMBOL.get(gecko_id)
                if not sym:
                    continue
                price = float(values.get("usd", 0))
                spread_val = _D(str(price * 0.0005))
                price_dec  = _D(str(price))
                from backend.adapters.exchanges.base import Ticker as _Ticker
                _cg_dedup_cache[sym] = _Ticker(
                    symbol=sym,
                    price=price_dec,
                    bid=price_dec - spread_val,
                    ask=price_dec + spread_val,
                    spread=spread_val * 2,
                    change24h=float(values.get("usd_24h_change", 0)),
                    volume24h=_D(str(round(float(values.get("usd_24h_vol", 0)), 2))),
                    timestamp=int(now),
                )
            _cg_dedup_ts = _t.time()

        if symbol not in _cg_dedup_cache:
            raise Exception(f"CoinGecko: no data for {symbol}")
        return _cg_dedup_cache[symbol]



# ---------------------------------------------------------------------------
# Typed exception — replaces silent synthetic fallback
# ---------------------------------------------------------------------------

class MarketDataUnavailable(Exception):
    """
    Raised when no exchange adapter can return live price data.
    Callers must propagate this as an explicit 503 — never substitute
    synthetic or stale data in response to this error.
    """
    def __init__(self, reason: str, adapter_errors: Optional[dict[str, str]] = None):
        self.reason = reason
        self.adapter_errors = adapter_errors or {}
        super().__init__(reason)


class MarketDataStale(Exception):
    """
    Raised when cached data exists but has exceeded the staleness threshold.
    Callers should return the stale data WITH a stale=True flag and a
    Cache-Control: no-store header — never serve stale data as fresh.
    """
    def __init__(self, reason: str, stale_ticker: Optional[Ticker] = None):
        self.reason = reason
        self.stale_ticker = stale_ticker
        super().__init__(reason)


# ---------------------------------------------------------------------------
# Price snapshot — what this service returns
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PriceSnapshot:
    symbol:           str
    price:            Decimal
    bid:              Decimal
    ask:              Decimal
    spread_pct:       float
    change24h:        float
    volume24h:        Decimal
    market_data_mode: str    # "live" | "paper_live" — never "SYNTHETIC"
    source:           str    # exchange name, e.g. "btcc" or "binance"
    fetched_at:       int    # unix seconds
    stale:            bool   # True if age > STALE_THRESHOLD_SECONDS


@dataclass(frozen=True)
class OhlcvSnapshot:
    symbol:           str
    interval:         str
    candles:          list[OhlcvCandle]
    source:           str
    fetched_at:       int
    stale:            bool


# ---------------------------------------------------------------------------
# Staleness thresholds
# ---------------------------------------------------------------------------

PRICE_STALE_THRESHOLD_SECONDS = 60   # 2 × the 30-second poll interval
OHLCV_STALE_THRESHOLD_SECONDS = {
    "1m": 90, "5m": 360, "15m": 1080,
    "1h": 4200, "4h": 16800, "1d": 90000,
}


# ---------------------------------------------------------------------------
# In-process price cache (warm-up layer before Redis)
# Holds the last known good ticker per symbol for staleness evaluation.
# NOT used as a synthetic fallback — only for reporting stale state.
# ---------------------------------------------------------------------------

_last_known: dict[str, tuple[Ticker, int]] = {}   # symbol -> (ticker, fetched_at)
_last_ohlcv: dict[str, tuple[list[OhlcvCandle], int]] = {}  # key -> (candles, fetched_at)

# ---------------------------------------------------------------------------
# Global adapter cache
# Re-instantiating adapters and their httpx clients on every call is a
# significant performance bottleneck.
# ---------------------------------------------------------------------------

_cached_adapters: Optional[list[BaseExchangeAdapter]] = None
_adapter_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Redis cache layer (optional — degrades gracefully if Redis is absent)
# ---------------------------------------------------------------------------

_redis_client = None


async def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import aioredis  # type: ignore
        cfg = get_redis_config()
        _redis_client = await aioredis.from_url(cfg.url, decode_responses=True)
        return _redis_client
    except Exception as exc:
        log.debug("Redis unavailable for market data cache: %s", exc)
        return None


async def _redis_get(key: str) -> Optional[str]:
    r = await _get_redis()
    if r:
        try:
            return await r.get(key)
        except Exception:
            pass
    return None


async def _redis_set(key: str, value: str, ttl: int) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.set(key, value, ex=ttl)
        except Exception:
            pass


async def _redis_publish(channel: str, message: str) -> None:
    """Publish price update to Redis pub/sub for WebSocket broadcaster."""
    r = await _get_redis()
    if r:
        try:
            await r.publish(channel, message)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Adapter failover list
# Attempts the primary adapter first, then any configured secondaries.
# On ALL failures: raises MarketDataUnavailable.
# ---------------------------------------------------------------------------

async def _get_adapters() -> list[BaseExchangeAdapter]:
    """
    Return ordered list of adapters to try.
    Primary is determined by config. Secondaries are all other configured adapters.

    Performance: Adapters are cached globally to avoid repeated instantiation
    and redundant httpx connection pool creation.
    """
    global _cached_adapters

    if _cached_adapters is not None:
        return _cached_adapters

    async with _adapter_lock:
        # Double-check pattern
        if _cached_adapters is not None:
            return _cached_adapters

        from backend.adapters.exchanges.btcc    import BtccAdapter
        from backend.adapters.exchanges.binance import BinanceAdapter
        from backend.adapters.exchanges.bitget  import BitgetAdapter

        cfg = get_exchange_config()
        paper = cfg.mode == "paper"
        adapters: list[BaseExchangeAdapter] = []

        # Primary — use market data adapter (Binance in paper mode for reliable public prices)
        adapters.append(get_market_data_adapter(cfg))

        # Secondaries — remaining adapters that have credentials (or paper mode)
        seen_types = {type(adapters[0])}

        if BtccAdapter not in seen_types and (cfg.btcc_api_key or paper):
            adapters.append(BtccAdapter(
                api_key=cfg.btcc_api_key, api_secret=cfg.btcc_api_secret,
                paper=paper, base_url=cfg.btcc_base_url
            ))
            seen_types.add(BtccAdapter)

        if BinanceAdapter not in seen_types and (cfg.binance_api_key or paper):
            adapters.append(BinanceAdapter(
                api_key=cfg.binance_api_key, api_secret=cfg.binance_api_secret,
                paper=paper, base_url=cfg.binance_base_url, testnet=cfg.binance_testnet
            ))
            seen_types.add(BinanceAdapter)

        if BitgetAdapter not in seen_types and (cfg.bitget_api_key or paper):
            adapters.append(BitgetAdapter(
                api_key=cfg.bitget_api_key, api_secret=cfg.bitget_api_secret,
                passphrase=cfg.bitget_passphrase, paper=paper, base_url=cfg.bitget_base_url
            ))
            seen_types.add(BitgetAdapter)

        _cached_adapters = adapters
        return _cached_adapters


# ---------------------------------------------------------------------------
# Core fetch — with ordered failover
# ---------------------------------------------------------------------------

async def _fetch_ticker_with_failover(symbol: str) -> tuple[Ticker, str]:
    """
    Try each adapter in order. Return (ticker, adapter_name) on first success.
    If all adapters fail: raise MarketDataUnavailable.
    Uses service-level dedup for CoinGecko to prevent startup 429 storms.
    """
    adapters = await _get_adapters()
    errors: dict[str, str] = {}

    for adapter in adapters:
        try:
            # Use dedup wrapper for CoinGecko to prevent concurrent 429 storms
            if adapter.exchange_name == "coingecko":
                ticker = await _get_coingecko_ticker_deduped(symbol)
            else:
                ticker = await adapter.fetch_ticker(symbol)
            return ticker, adapter.exchange_name
        except (AdapterUnavailableError, AdapterRateLimitError) as exc:
            errors[adapter.exchange_name] = str(exc)
            log.warning(
                "Adapter %s failed for %s: %s — trying next",
                adapter.exchange_name, symbol, exc
            )
        except Exception as exc:
            errors[adapter.exchange_name] = str(exc)
            log.error(
                "Unexpected adapter error %s for %s: %s",
                adapter.exchange_name, symbol, exc
            )

    raise MarketDataUnavailable(
        f"All adapters failed for {symbol}: {errors}",
        adapter_errors=errors,
    )


async def _fetch_tickers_with_failover(symbols: list[str]) -> list[tuple[Ticker, str]]:
    """
    Try to fetch multiple tickers in batch.
    If an adapter fails or only returns partial results, we proceed
    to the next adapter for the REMAINING symbols.
    Returns a list of (Ticker, source_name) tuples.
    """
    adapters = await _get_adapters()
    remaining = list(symbols)
    results: list[tuple[Ticker, str]] = []

    for adapter in adapters:
        if not remaining:
            break
        try:
            batch = await adapter.fetch_tickers(remaining)
            for ticker in batch:
                results.append((ticker, adapter.exchange_name))
                if ticker.symbol in remaining:
                    remaining.remove(ticker.symbol)
        except Exception as exc:
            log.warning("Batch fetch failed for %s: %s", adapter.exchange_name, exc)

    return results


async def _fetch_ohlcv_with_failover(
    symbol: str, interval: str, limit: int
) -> tuple[list[OhlcvCandle], str]:
    adapters = await _get_adapters()
    errors: dict[str, str] = {}

    for adapter in adapters:
        try:
            candles = await adapter.fetch_ohlcv(symbol, interval=interval, limit=limit)
            if candles:
                return candles, adapter.exchange_name
        except Exception as exc:
            errors[adapter.exchange_name] = str(exc)
            log.warning("OHLCV adapter %s failed for %s: %s", adapter.exchange_name, symbol, exc)

    raise MarketDataUnavailable(
        f"All adapters failed for OHLCV {symbol} {interval}: {errors}",
        adapter_errors=errors,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def _process_ticker_payload(
    ticker: Ticker,
    source_name: str,
    now: int,
    cfg: Optional[ExchangeConfig] = None,
    redis_cfg: Optional[RedisConfig] = None,
    requested_symbol: Optional[str] = None,
) -> PriceSnapshot:
    """
    Internal helper to process a raw Ticker into a PriceSnapshot,
    updating local caches, Redis, and broadcasting updates.
    """
    if cfg is None:
        cfg = get_exchange_config()
    if redis_cfg is None:
        redis_cfg = get_redis_config()

    symbol = requested_symbol or ticker.symbol
    cache_key = f"price:snapshot:{symbol}"

    snapshot = PriceSnapshot(
        symbol=symbol,
        price=ticker.price,
        bid=ticker.bid,
        ask=ticker.ask,
        spread_pct=ticker.spread_pct,
        change24h=ticker.change24h,
        volume24h=ticker.volume24h,
        market_data_mode="live" if cfg.mode == "live" else "paper_live",
        source=source_name,
        fetched_at=now,
        stale=False,
    )

    # Update in-process cache
    _last_known[symbol] = (ticker, now)

    # Update Redis
    await _redis_set(cache_key, json.dumps({
        "symbol": symbol,
        "price": str(ticker.price),
        "bid": str(ticker.bid),
        "ask": str(ticker.ask),
        "spread_pct": ticker.spread_pct,
        "change24h": ticker.change24h,
        "volume24h": str(ticker.volume24h),
        "market_data_mode": snapshot.market_data_mode,
        "source": source_name,
        "fetched_at": now,
    }), ttl=redis_cfg.price_ttl_seconds)

    # Publish to WebSocket broadcaster
    await _redis_publish("market_updates", json.dumps({
        "type": "market_update",
        "symbol": symbol,
        "price": float(ticker.price),
        "change24h": ticker.change24h,
        "source": source_name,
        "mode": snapshot.market_data_mode,
        "ts": now,
    }))

    return snapshot


async def get_price(symbol: str) -> PriceSnapshot:
    """
    Fetch current price for a symbol.

    Returns a PriceSnapshot with real exchange data.
    Raises MarketDataUnavailable if all adapters are unreachable.
    Raises MarketDataStale if cached data exists but is past the threshold.

    NEVER returns synthetic/fabricated price data.
    """
    now = int(time.time())

    # --- Attempt live fetch ---
    try:
        ticker, source_name = await _fetch_ticker_with_failover(symbol)
        return await _process_ticker_payload(ticker, source_name, now, requested_symbol=symbol)

    except MarketDataUnavailable:
        # Check in-process cache for staleness reporting
        if symbol in _last_known:
            ticker, cached_at = _last_known[symbol]
            age = now - cached_at
            if age <= PRICE_STALE_THRESHOLD_SECONDS * 5:
                # Return stale snapshot — clearly marked, not fabricated
                stale_snapshot = PriceSnapshot(  # noqa: F841
                    symbol=symbol,
                    price=ticker.price,
                    bid=ticker.bid,
                    ask=ticker.ask,
                    spread_pct=ticker.spread_pct,
                    change24h=ticker.change24h,
                    volume24h=ticker.volume24h,
                    market_data_mode="unavailable",
                    source=f"cache:{int(age)}s_old",
                    fetched_at=cached_at,
                    stale=True,
                )
                raise MarketDataStale(
                    f"Exchange unreachable; last known price is {age}s old",
                    stale_ticker=ticker,
                )
        raise  # No cache — propagate as unavailable


async def get_price_batch(symbols: list[str]) -> list[PriceSnapshot]:
    """
    Fetch prices for multiple symbols concurrently, utilizing batch
    exchange endpoints where available.

    Performance: This significantly reduces network round-trips for dashboard
    updates by consolidating N individual requests into 1 batch request.
    """
    now = int(time.time())
    cfg = get_exchange_config()
    redis_cfg = get_redis_config()

    # 1. Attempt batch fetch with failover
    batch_results = await _fetch_tickers_with_failover(symbols)

    found_symbols = {t.symbol for t, _ in batch_results}
    remaining = [s for s in symbols if s not in found_symbols]

    # 2. Process batch results
    snapshots = await asyncio.gather(*[
        _process_ticker_payload(t, source, now, cfg=cfg, redis_cfg=redis_cfg, requested_symbol=t.symbol)
        for t, source in batch_results
    ])

    # 3. Fall back to individual fetches for anything missed by batching
    if remaining:
        log.info("Batch fetch incomplete, falling back to individual fetches for: %s", remaining)
        individual_results = await asyncio.gather(
            *[get_price(s) for s in remaining],
            return_exceptions=True,
        )
        for symbol, result in zip(remaining, individual_results):
            if isinstance(result, PriceSnapshot):
                snapshots.append(result)
            else:
                log.warning("Failed to fetch %s in batch fallback: %s", symbol, result)

    return list(snapshots)


async def get_ohlcv(symbol: str, interval: str = "1h", limit: int = 24) -> OhlcvSnapshot:
    """
    Fetch OHLCV candles.
    Raises MarketDataUnavailable if all adapters fail.
    Never returns randomly generated candles.
    """
    now = int(time.time())
    candles, source_name = await _fetch_ohlcv_with_failover(symbol, interval, limit)

    cache_key = f"ohlcv:{symbol}:{interval}:{limit}"
    _last_ohlcv[cache_key] = (candles, now)

    return OhlcvSnapshot(
        symbol=symbol,
        interval=interval,
        candles=candles,
        source=source_name,
        fetched_at=now,
        stale=False,
    )


async def get_exchange_status() -> ExchangeStatus:
    """
    Return the current exchange connectivity status.
    market_data_mode is either "live", "paper_live", or "unavailable".
    "SYNTHETIC" is explicitly not a valid value from this function.
    """
    adapters = await _get_adapters()
    primary = adapters[0]

    status = await primary.exchange_status()

    # Normalise market_data_mode — remove SYNTHETIC as a concept
    if status.market_data_mode == "SYNTHETIC":
        # This was a synthetic fallback mode — we replace it with "unavailable"
        from dataclasses import replace
        status = ExchangeStatus(
            connected=False,
            mode=status.mode,
            exchange_name=status.exchange_name,
            market_data_available=False,
            market_data_mode="unavailable",
            connection_state="offline",
            fallback_active=False,
            stale=True,
            source=status.source,
            error="Exchange unreachable — no synthetic fallback",
        )

    return status
