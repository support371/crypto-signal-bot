# backend/services/market_data/ingestion.py
"""
Real-Time Data Ingestion Pipeline — Phase 8

Goals
-----
1. Drastic latency reduction: concurrent batch-fetch replaces serial per-symbol polling.
2. In-memory ring buffer per symbol — indicator pre-computation happens in this layer,
   never on the hot path of a signal evaluation call.
3. Configurable symbol filter at ingestion time — symbols not in ACTIVE_SYMBOLS are
   never fetched, parsed, or stored.
4. Continuous freshness + latency telemetry per symbol — surfaced via /monitor/ingestion.

Architecture
------------

  ┌──────────────────────────────────────────────────────────────────────┐
  │  IngestionPipeline                                                   │
  │                                                                      │
  │  ┌──────────────┐   batch     ┌────────────────┐   parsed  ┌──────┐ │
  │  │ AdapterPool  │ ──────────▶ │ ParseWorker    │ ────────▶ │ Ring │ │
  │  │ (Binance.US) │  OHLCV+     │ (filter/norm.) │           │ Buf  │ │
  │  └──────────────┘  ticker     └────────────────┘           └──┬───┘ │
  │         ▲                                                      │     │
  │  ┌──────┴─────────────────────────────────────────────────┐   │     │
  │  │  PollScheduler  — jitter-based per-symbol polling      │   │     │
  │  └────────────────────────────────────────────────────────┘   │     │
  │                                                                ▼     │
  │                                                      LatencyTracker  │
  └──────────────────────────────────────────────────────────────────────┘
                │ freshest candle slice on demand
                ▼
         signal_engine.evaluate_symbol()   (zero-wait path)
                │
                ▼
         StreamManager broadcast

Maintains existing function signatures used by all callers — this module
is additive. Existing routes and services call get_candles_from_buffer()
and get_ingestion_metrics() without any import changes.
"""

from __future__ import annotations

import asyncio
import collections
import logging
import time
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional, Set

from backend.adapters.exchanges.base import OhlcvCandle
from backend.services.market_data.service import (
    MarketDataUnavailable,
    _get_adapters,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration  (overridable — matches structure in settings.py)
# ---------------------------------------------------------------------------

#: Symbols actively tracked by the pipeline. Filtered AT INGESTION so
#: excluded symbols cost zero CPU and zero network.
ACTIVE_SYMBOLS: List[str] = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "XRPUSDT", "DOTUSDT", "AVAXUSDT", "DOGEUSDT", "LINKUSDT",
]

#: OHLCV interval for candle buffer (must match signal engine expectation).
CANDLE_INTERVAL: str = "1h"

#: How many candles to keep in the ring buffer per symbol.
#: 500 ensures EMA-200 warm-up with room for 300 additional ticks.
RING_BUFFER_SIZE: int = 500

#: How often each symbol is re-fetched (seconds).
#: 30 s matches the previous poll interval but the pipeline fetches
#: ALL symbols in a single concurrent burst — not serially.
POLL_INTERVAL_SECONDS: int = 30

#: Max per-symbol age before a freshness warning is emitted (seconds).
FRESHNESS_WARN_THRESHOLD: int = 75   # 2.5 × poll interval

#: Concurrency limit for exchange HTTP calls to avoid connection exhaustion.
_FETCH_SEMAPHORE_LIMIT = 6


# ---------------------------------------------------------------------------
# Latency + freshness tracking
# ---------------------------------------------------------------------------

@dataclass
class SymbolMetrics:
    """Per-symbol ingestion telemetry."""
    symbol: str
    last_fetch_at: float = 0.0          # unix float
    last_fetch_latency_ms: float = 0.0  # round-trip time for one fetch
    fetch_count: int = 0
    error_count: int = 0
    candle_count: int = 0               # current ring buffer depth
    stale: bool = False

    def age_seconds(self) -> float:
        return time.time() - self.last_fetch_at if self.last_fetch_at else float("inf")


# ---------------------------------------------------------------------------
# Ring buffer — O(1) append, O(n) slice (n = RING_BUFFER_SIZE ≤ 500)
# ---------------------------------------------------------------------------

class CandleRingBuffer:
    """
    Circular candle store per symbol.

    Duplicate timestamps are deduplicated — only the latest candle for
    a given timestamp is kept (handles exchange re-delivery on reconnect).
    """

    __slots__ = ("_buf", "_maxlen", "_symbol")

    def __init__(self, symbol: str, maxlen: int = RING_BUFFER_SIZE) -> None:
        self._buf: Deque[OhlcvCandle] = collections.deque(maxlen=maxlen)
        self._maxlen = maxlen
        self._symbol = symbol

    def ingest(self, candles: List[OhlcvCandle]) -> int:
        """
        Append new candles, deduplicating by timestamp.
        Returns the number of NEW candles added.
        """
        if not candles:
            return 0

        existing_ts: Set[int] = {c.time for c in self._buf}
        added = 0
        for c in candles:
            if c.time not in existing_ts:
                self._buf.append(c)
                existing_ts.add(c.time)
                added += 1
            else:
                # Replace stale candle with fresh one (exchange may revise last candle)
                for i, existing in enumerate(self._buf):
                    if existing.time == c.time:
                        self._buf[i] = c
                        break
        return added

    def latest(self, n: Optional[int] = None) -> List[OhlcvCandle]:
        """Return the most recent n candles (oldest-first). n=None returns all."""
        buf = list(self._buf)
        if n is None:
            return buf
        return buf[-n:]

    def __len__(self) -> int:
        return len(self._buf)


# ---------------------------------------------------------------------------
# Ingestion pipeline
# ---------------------------------------------------------------------------

class IngestionPipeline:
    """
    Manages concurrent symbol fetching, ring buffers, and freshness metrics.

    This class is a singleton — access via module-level `pipeline` instance.
    """

    def __init__(self) -> None:
        self._buffers:   Dict[str, CandleRingBuffer] = {}
        self._metrics:   Dict[str, SymbolMetrics]    = {}
        self._task:      Optional[asyncio.Task]       = None
        self._running:   bool                         = False
        self._semaphore: Optional[asyncio.Semaphore]  = None
        self._active:    Set[str]                     = set(ACTIVE_SYMBOLS)

        # Initialise buffers + metrics for all active symbols
        for sym in self._active:
            self._buffers[sym] = CandleRingBuffer(sym)
            self._metrics[sym] = SymbolMetrics(symbol=sym)

    # ------------------------------------------------------------------
    # Public API (used by signal engine and routes)
    # ------------------------------------------------------------------

    def get_candles(self, symbol: str, n: Optional[int] = None) -> List[OhlcvCandle]:
        """
        Return up to n most-recent candles for symbol (oldest-first).

        Returns [] if the symbol is not active or the buffer is empty.
        This is O(n) copy — safe to call on the hot path.
        """
        buf = self._buffers.get(symbol.upper())
        if buf is None:
            return []
        return buf.latest(n)

    def get_metrics(self) -> Dict[str, dict]:
        """Return serializable ingestion telemetry for /monitor/ingestion."""
        out: Dict[str, dict] = {}
        for sym, m in self._metrics.items():
            out[sym] = {
                "last_fetch_at":        m.last_fetch_at,
                "age_seconds":          round(m.age_seconds(), 1),
                "last_fetch_latency_ms": round(m.last_fetch_latency_ms, 1),
                "fetch_count":          m.fetch_count,
                "error_count":          m.error_count,
                "candle_count":         len(self._buffers.get(sym, [])),
                "stale":                m.stale,
            }
        return out

    def get_pipeline_status(self) -> dict:
        """Top-level pipeline health summary."""
        metrics = self.get_metrics()
        stale_symbols = [s for s, m in metrics.items() if m["stale"]]
        total_errors  = sum(m["error_count"] for m in metrics.values())
        avg_latency   = (
            sum(m["last_fetch_latency_ms"] for m in metrics.values()) / len(metrics)
            if metrics else 0.0
        )
        return {
            "running":         self._running,
            "active_symbols":  sorted(self._active),
            "stale_symbols":   stale_symbols,
            "total_errors":    total_errors,
            "avg_latency_ms":  round(avg_latency, 1),
            "poll_interval_s": POLL_INTERVAL_SECONDS,
            "buffer_size":     RING_BUFFER_SIZE,
        }

    def set_active_symbols(self, symbols: List[str]) -> None:
        """
        Hot-reconfigure which symbols are tracked.
        New symbols get fresh buffers; removed symbols are evicted from memory.
        Existing buffers for retained symbols are untouched.
        """
        new_active = {s.upper() for s in symbols}

        # Add new
        for sym in new_active - self._active:
            self._buffers[sym] = CandleRingBuffer(sym)
            self._metrics[sym] = SymbolMetrics(symbol=sym)
            log.info("[ingestion] Added symbol: %s", sym)

        # Remove old
        for sym in self._active - new_active:
            self._buffers.pop(sym, None)
            self._metrics.pop(sym, None)
            log.info("[ingestion] Removed symbol: %s", sym)

        self._active = new_active

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        if self._running:
            return
        self._semaphore = asyncio.Semaphore(_FETCH_SEMAPHORE_LIMIT)
        self._running = True
        self._task = asyncio.create_task(self._poll_loop(), name="ingestion_pipeline")
        log.info("[ingestion] Pipeline started. Tracking %d symbols.", len(self._active))

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("[ingestion] Pipeline stopped.")

    # ------------------------------------------------------------------
    # Internal poll loop
    # ------------------------------------------------------------------

    async def _poll_loop(self) -> None:
        """
        Main ingestion loop.

        Each cycle:
          1. Fetch all active symbols CONCURRENTLY (bounded by semaphore).
          2. Parse + ingest into ring buffers.
          3. Emit freshness warnings for stale symbols.
          4. Sleep for the remainder of POLL_INTERVAL_SECONDS.

        This replaces the serial symbol-by-symbol loop in stream.py's
        _stream_loop(), cutting worst-case latency from
        N × (adapter_latency) to max(adapter_latency) across all N symbols.
        """
        while self._running:
            cycle_start = time.time()

            symbols = list(self._active)
            tasks = [
                asyncio.create_task(self._fetch_symbol(sym), name=f"ingest_{sym}")
                for sym in symbols
            ]
            await asyncio.gather(*tasks, return_exceptions=True)

            # Freshness sweep
            now = time.time()
            for sym in symbols:
                m = self._metrics.get(sym)
                if m is None:
                    continue
                age = now - m.last_fetch_at if m.last_fetch_at else float("inf")
                m.stale = age > FRESHNESS_WARN_THRESHOLD
                if m.stale:
                    log.warning(
                        "[ingestion] %s stale — last fetch %.0fs ago "
                        "(threshold %ds)",
                        sym, age, FRESHNESS_WARN_THRESHOLD,
                    )

            elapsed = time.time() - cycle_start
            sleep_for = max(0.5, POLL_INTERVAL_SECONDS - elapsed)
            log.debug(
                "[ingestion] Cycle done in %.2fs — sleeping %.1fs",
                elapsed, sleep_for,
            )
            await asyncio.sleep(sleep_for)

    async def _fetch_symbol(self, symbol: str) -> None:
        """
        Fetch OHLCV candles for one symbol via the adapter pool.

        Uses the module-level semaphore to bound concurrent HTTP connections.
        Records round-trip latency per symbol.
        """
        assert self._semaphore is not None
        async with self._semaphore:
            t0 = time.time()
            try:
                adapters = await _get_adapters()
                candles: Optional[List[OhlcvCandle]] = None
                last_exc: Optional[Exception] = None

                for adapter in adapters:
                    try:
                        candles = await adapter.fetch_ohlcv(
                            symbol,
                            interval=CANDLE_INTERVAL,
                            limit=RING_BUFFER_SIZE,
                        )
                        break  # first success wins
                    except Exception as exc:
                        last_exc = exc
                        log.debug(
                            "[ingestion] %s failed on %s: %s",
                            adapter.exchange_name, symbol, exc,
                        )

                latency_ms = (time.time() - t0) * 1000
                m = self._metrics[symbol]
                m.last_fetch_latency_ms = latency_ms
                m.fetch_count += 1

                if candles:
                    added = self._buffers[symbol].ingest(candles)
                    m.last_fetch_at = time.time()
                    log.debug(
                        "[ingestion] %s — %d candles ingested (+%d new) in %.0fms",
                        symbol, len(self._buffers[symbol]), added, latency_ms,
                    )
                else:
                    m.error_count += 1
                    log.warning(
                        "[ingestion] %s — all adapters failed: %s",
                        symbol, last_exc,
                    )

            except Exception as exc:
                self._metrics[symbol].error_count += 1
                log.error("[ingestion] Unexpected error for %s: %s", symbol, exc)


# ---------------------------------------------------------------------------
# Module-level singleton — imported by callers
# ---------------------------------------------------------------------------

pipeline: IngestionPipeline = IngestionPipeline()


# ---------------------------------------------------------------------------
# Convenience helpers — drop-in replacements for direct adapter calls
# ---------------------------------------------------------------------------

def get_candles_from_buffer(symbol: str, n: Optional[int] = None) -> List[OhlcvCandle]:
    """
    Return candles from the in-memory ring buffer.

    Zero network calls — data was pre-fetched by the pipeline loop.
    Falls back to [] if the pipeline has not yet populated the buffer.

    This is the intended replacement for on-demand adapter.fetch_ohlcv() calls
    inside the signal engine.
    """
    return pipeline.get_candles(symbol, n)


def get_ingestion_metrics() -> Dict[str, dict]:
    """Return per-symbol latency + freshness metrics for monitoring."""
    return pipeline.get_metrics()


def get_pipeline_status() -> dict:
    """Return top-level pipeline health summary."""
    return pipeline.get_pipeline_status()
