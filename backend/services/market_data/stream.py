# backend/services/market_data/stream.py
"""
PHASE 6 — Ordered price stream.

Continuously polls the exchange adapters for all tracked symbols and
publishes updates to Redis pub/sub for the WebSocket broadcaster.

Replaces any background synthetic price generation loop.

Rules:
  - Stream publishes real prices or stops — never fabricated values.
  - Stale detection: if a symbol has not been successfully refreshed
    within STALE_THRESHOLD_SECONDS, its next publication carries stale=True.
  - Stream failure does not affect the HTTP price endpoints — they fail
    independently with explicit errors.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from backend.services.market_data.service import (
    MarketDataUnavailable,
    MarketDataStale,
    PriceSnapshot,
    PRICE_STALE_THRESHOLD_SECONDS,
    _redis_publish,
    get_price,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tracked symbols (mirrors frontend TRACKED_COINS)
# ---------------------------------------------------------------------------

TRACKED_SYMBOLS: list[str] = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "XRPUSDT", "DOTUSDT", "AVAXUSDT", "DOGEUSDT", "LINKUSDT",
]

# ---------------------------------------------------------------------------
# Stream state
# ---------------------------------------------------------------------------

_stream_task:  Optional[asyncio.Task] = None
_stream_running: bool = False
_symbol_last_success: dict[str, int] = {}  # symbol -> last successful fetch unix ts
_symbol_error_count:  dict[str, int] = {}  # symbol -> consecutive error count

CONSECUTIVE_ERROR_HALT = 10   # halt individual symbol after this many failures
POLL_INTERVAL_SECONDS  = 30   # match frontend 30s poll interval


async def _poll_symbol(symbol: str, now: int) -> Optional[PriceSnapshot]:
    """
    Fetch one symbol. Returns snapshot or None on failure.
    Increments error counter; logs stale detection.
    """
    try:
        snapshot = await get_price(symbol)
        _symbol_last_success[symbol] = now
        _symbol_error_count[symbol] = 0
        return snapshot
    except MarketDataUnavailable as exc:
        count = _symbol_error_count.get(symbol, 0) + 1
        _symbol_error_count[symbol] = count
        log.warning(
            "Market data unavailable for %s (error #%d): %s",
            symbol, count, exc.reason
        )
        return None
    except Exception as exc:
        count = _symbol_error_count.get(symbol, 0) + 1
        _symbol_error_count[symbol] = count
        log.error("Unexpected error polling %s: %s", symbol, exc)
        return None


async def _stream_loop() -> None:
    """
    Main stream loop.

    Each cycle:
      1. Poll all tracked symbols concurrently.
      2. Publish successful results to Redis pub/sub.
      3. For symbols that have exceeded STALE_THRESHOLD: publish stale alert.
      4. Sleep until next cycle.

    The loop never generates synthetic prices. On persistent adapter failure,
    affected symbols publish a "unavailable" event — not fake data.
    """
    global _stream_running
    _stream_running = True
    log.info("[market-data stream] Started. Tracking %d symbols.", len(TRACKED_SYMBOLS))

    while _stream_running:
        cycle_start = int(time.time())

        # Gather results for all symbols concurrently
        tasks = [_poll_symbol(sym, cycle_start) for sym in TRACKED_SYMBOLS]
        results = await asyncio.gather(*tasks, return_exceptions=False)

        for symbol, snapshot in zip(TRACKED_SYMBOLS, results):
            if snapshot is None:
                # Check if symbol has gone stale
                last_ok = _symbol_last_success.get(symbol, 0)
                age = cycle_start - last_ok if last_ok else None

                if last_ok and age and age > PRICE_STALE_THRESHOLD_SECONDS:
                    # Publish stale alert — not synthetic data
                    await _redis_publish("market_updates", json.dumps({
                        "type": "market_update",
                        "symbol": symbol,
                        "price": None,
                        "stale": True,
                        "stale_age_seconds": age,
                        "source": "unavailable",
                        "mode": "unavailable",
                        "ts": cycle_start,
                    }))
                    log.warning(
                        "[market-data stream] %s stale for %ds",
                        symbol, age
                    )
                elif not last_ok:
                    # Never had a successful fetch — publish unavailable event
                    await _redis_publish("market_updates", json.dumps({
                        "type": "market_update",
                        "symbol": symbol,
                        "price": None,
                        "stale": False,
                        "source": "unavailable",
                        "mode": "unavailable",
                        "error": f"exchange_unreachable",
                        "ts": cycle_start,
                    }))
            # Successful snapshots are published inside get_price() directly

        # Sleep for remainder of poll interval
        elapsed = int(time.time()) - cycle_start
        sleep_for = max(1, POLL_INTERVAL_SECONDS - elapsed)
        await asyncio.sleep(sleep_for)

    _stream_running = False
    log.info("[market-data stream] Stopped.")


# ---------------------------------------------------------------------------
# Stream lifecycle
# ---------------------------------------------------------------------------

async def start_stream() -> None:
    """Start the background price stream. Call once at app startup."""
    global _stream_task, _stream_running
    if _stream_running:
        log.info("[market-data stream] Already running.")
        return
    _stream_task = asyncio.create_task(_stream_loop())
    log.info("[market-data stream] Task created.")


async def stop_stream() -> None:
    """Stop the background stream. Call at app shutdown."""
    global _stream_running, _stream_task
    _stream_running = False
    if _stream_task and not _stream_task.done():
        _stream_task.cancel()
        try:
            await _stream_task
        except asyncio.CancelledError:
            pass
    log.info("[market-data stream] Stopped cleanly.")


def get_stream_status() -> dict:
    """Return stream health for the /health endpoint."""
    return {
        "running": _stream_running,
        "tracked_symbols": len(TRACKED_SYMBOLS),
        "symbol_errors": {
            sym: count
            for sym, count in _symbol_error_count.items()
            if count > 0
        },
        "symbol_last_success": _symbol_last_success.copy(),
    }
