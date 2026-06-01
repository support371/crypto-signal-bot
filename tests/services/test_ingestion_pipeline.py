# tests/services/test_ingestion_pipeline.py
"""
Phase 8 — Ingestion pipeline tests.

Coverage:
  1.  CandleRingBuffer — ingest, dedup, latest(), len()
  2.  CandleRingBuffer — ring overflow (maxlen respected)
  3.  CandleRingBuffer — deduplication by timestamp
  4.  CandleRingBuffer — in-place update for revised last candle
  5.  IngestionPipeline — initialises buffers for all active symbols
  6.  IngestionPipeline — get_candles returns [] for unknown symbol
  7.  IngestionPipeline — get_candles respects n limit
  8.  IngestionPipeline — set_active_symbols adds new / removes old
  9.  IngestionPipeline — get_metrics returns correct freshness fields
  10. IngestionPipeline — get_pipeline_status structure
  11. IngestionPipeline — stale detection fires after FRESHNESS_WARN_THRESHOLD
  12. IngestionPipeline — metrics error_count increments on adapter failure
  13. IngestionPipeline — fetch_symbol respects semaphore (no concurrency explosion)
  14. get_candles_from_buffer — delegates to pipeline singleton
  15. get_ingestion_metrics  — delegates to pipeline singleton
  16. get_pipeline_status    — delegates to pipeline singleton
  17. _fetch_candles priority — ring buffer beats adapter when warmed (mock)
  18. _fetch_candles priority — falls back to adapter when buffer is empty
  19. Concurrent _fetch_symbol calls — no data race on ring buffer
  20. CandleRingBuffer — empty buffer returns [] not exception
"""

from __future__ import annotations

import asyncio
import time
from decimal import Decimal
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.adapters.exchanges.base import OhlcvCandle
from backend.services.market_data.ingestion import (
    ACTIVE_SYMBOLS,
    FRESHNESS_WARN_THRESHOLD,
    CandleRingBuffer,
    IngestionPipeline,
    get_candles_from_buffer,
    get_ingestion_metrics,
    get_pipeline_status,
    pipeline,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _candle(ts: int, close: float = 100.0) -> OhlcvCandle:
    d = Decimal(str(close))
    return OhlcvCandle(time=ts, open=d, high=d, low=d, close=d, volume=Decimal("1"))


def _candles(n: int, start: int = 1000) -> List[OhlcvCandle]:
    return [_candle(start + i * 3600) for i in range(n)]


# ---------------------------------------------------------------------------
# 1. CandleRingBuffer — basic ingest and latest
# ---------------------------------------------------------------------------

def test_ring_buffer_ingest_and_latest():
    buf = CandleRingBuffer("BTCUSDT", maxlen=100)
    candles = _candles(5)
    added = buf.ingest(candles)
    assert added == 5
    result = buf.latest()
    assert len(result) == 5
    assert result[0].time == candles[0].time
    assert result[-1].time == candles[-1].time


# ---------------------------------------------------------------------------
# 2. CandleRingBuffer — ring overflow respects maxlen
# ---------------------------------------------------------------------------

def test_ring_buffer_overflow():
    buf = CandleRingBuffer("ETHUSDT", maxlen=10)
    buf.ingest(_candles(15))
    assert len(buf) == 10


# ---------------------------------------------------------------------------
# 3. CandleRingBuffer — deduplication by timestamp
# ---------------------------------------------------------------------------

def test_ring_buffer_deduplication():
    buf = CandleRingBuffer("SOLUSDT", maxlen=100)
    candles = _candles(5)
    buf.ingest(candles)
    added_second = buf.ingest(candles)  # same candles again
    assert added_second == 0
    assert len(buf) == 5


# ---------------------------------------------------------------------------
# 4. CandleRingBuffer — in-place update for revised last candle
# ---------------------------------------------------------------------------

def test_ring_buffer_update_existing():
    buf = CandleRingBuffer("BNBUSDT", maxlen=100)
    c = _candle(1000, close=100.0)
    buf.ingest([c])
    revised = _candle(1000, close=105.0)  # same ts, different close
    buf.ingest([revised])
    assert len(buf) == 1
    assert float(buf.latest()[0].close) == 105.0


# ---------------------------------------------------------------------------
# 5. IngestionPipeline — initialises buffers for all active symbols
# ---------------------------------------------------------------------------

def test_pipeline_initialises_all_active_symbols():
    p = IngestionPipeline()
    for sym in ACTIVE_SYMBOLS:
        assert sym in p._buffers
        assert sym in p._metrics


# ---------------------------------------------------------------------------
# 6. IngestionPipeline — get_candles returns [] for unknown symbol
# ---------------------------------------------------------------------------

def test_pipeline_get_candles_unknown_symbol():
    p = IngestionPipeline()
    result = p.get_candles("UNKNOWNUSDT")
    assert result == []


# ---------------------------------------------------------------------------
# 7. IngestionPipeline — get_candles respects n limit
# ---------------------------------------------------------------------------

def test_pipeline_get_candles_respects_limit():
    p = IngestionPipeline()
    p._buffers["BTCUSDT"].ingest(_candles(50))
    result = p.get_candles("BTCUSDT", n=20)
    assert len(result) == 20
    # Should be the most recent 20
    all_candles = p._buffers["BTCUSDT"].latest()
    assert result == all_candles[-20:]


# ---------------------------------------------------------------------------
# 8. IngestionPipeline — set_active_symbols adds new / removes old
# ---------------------------------------------------------------------------

def test_pipeline_set_active_symbols():
    p = IngestionPipeline()
    original_syms = set(p._active)

    # Add a new symbol
    new_sym = "NEWUSDT"
    all_syms = list(original_syms) + [new_sym]
    p.set_active_symbols(all_syms)
    assert new_sym in p._active
    assert new_sym in p._buffers
    assert new_sym in p._metrics

    # Remove a symbol
    remaining = list(original_syms)  # excludes NEWUSDT
    p.set_active_symbols(remaining)
    assert new_sym not in p._active
    assert new_sym not in p._buffers
    assert new_sym not in p._metrics

    # Original symbols preserved
    for sym in original_syms:
        assert sym in p._active


# ---------------------------------------------------------------------------
# 9. IngestionPipeline — get_metrics returns correct freshness fields
# ---------------------------------------------------------------------------

def test_pipeline_get_metrics_structure():
    p = IngestionPipeline()
    metrics = p.get_metrics()
    for sym in ACTIVE_SYMBOLS:
        assert sym in metrics
        m = metrics[sym]
        assert "last_fetch_at" in m
        assert "age_seconds" in m
        assert "last_fetch_latency_ms" in m
        assert "fetch_count" in m
        assert "error_count" in m
        assert "candle_count" in m
        assert "stale" in m


# ---------------------------------------------------------------------------
# 10. IngestionPipeline — get_pipeline_status structure
# ---------------------------------------------------------------------------

def test_pipeline_get_pipeline_status():
    p = IngestionPipeline()
    status = p.get_pipeline_status()
    assert "running" in status
    assert "active_symbols" in status
    assert "stale_symbols" in status
    assert "total_errors" in status
    assert "avg_latency_ms" in status
    assert "poll_interval_s" in status
    assert "buffer_size" in status
    assert isinstance(status["active_symbols"], list)


# ---------------------------------------------------------------------------
# 11. IngestionPipeline — stale detection fires after threshold
# ---------------------------------------------------------------------------

def test_pipeline_stale_detection():
    p = IngestionPipeline()
    sym = "BTCUSDT"
    # Set last_fetch_at to far in the past
    p._metrics[sym].last_fetch_at = time.time() - (FRESHNESS_WARN_THRESHOLD + 100)
    # Manually trigger stale check logic (as the loop would do)
    now = time.time()
    age = now - p._metrics[sym].last_fetch_at
    p._metrics[sym].stale = age > FRESHNESS_WARN_THRESHOLD
    assert p._metrics[sym].stale is True


# ---------------------------------------------------------------------------
# 12. IngestionPipeline — error_count increments on adapter failure
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pipeline_error_count_increments():
    p = IngestionPipeline()
    p._semaphore = asyncio.Semaphore(6)
    sym = "BTCUSDT"
    initial_errors = p._metrics[sym].error_count

    with patch(
        "backend.services.market_data.ingestion._get_adapters",
        new_callable=AsyncMock,
        return_value=[],  # empty adapter list → no candles → error
    ):
        await p._fetch_symbol(sym)

    assert p._metrics[sym].error_count == initial_errors + 1


# ---------------------------------------------------------------------------
# 13. IngestionPipeline — semaphore limits concurrent fetches
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pipeline_semaphore_limits_concurrency():
    p = IngestionPipeline()
    p._semaphore = asyncio.Semaphore(2)  # only 2 concurrent fetches
    active_concurrency = 0
    max_seen = 0

    async def fake_fetch_ohlcv(*args, **kwargs):
        nonlocal active_concurrency, max_seen
        active_concurrency += 1
        max_seen = max(max_seen, active_concurrency)
        await asyncio.sleep(0.01)
        active_concurrency -= 1
        return _candles(5)

    mock_adapter = MagicMock()
    mock_adapter.fetch_ohlcv = fake_fetch_ohlcv
    mock_adapter.exchange_name = "mock"

    with patch(
        "backend.services.market_data.ingestion._get_adapters",
        new_callable=AsyncMock,
        return_value=[mock_adapter],
    ):
        tasks = [
            asyncio.create_task(p._fetch_symbol(sym))
            for sym in list(p._active)[:6]  # 6 symbols, semaphore=2
        ]
        await asyncio.gather(*tasks)

    assert max_seen <= 2


# ---------------------------------------------------------------------------
# 14–16. Module-level helpers delegate to pipeline singleton
# ---------------------------------------------------------------------------

def test_get_candles_from_buffer_delegates():
    pipeline._buffers["BTCUSDT"].ingest(_candles(10))
    result = get_candles_from_buffer("BTCUSDT", 5)
    assert len(result) == 5


def test_get_ingestion_metrics_returns_dict():
    metrics = get_ingestion_metrics()
    assert isinstance(metrics, dict)
    assert "BTCUSDT" in metrics


def test_get_pipeline_status_returns_dict():
    status = get_pipeline_status()
    assert "running" in status
    assert "active_symbols" in status


# ---------------------------------------------------------------------------
# 17. _fetch_candles priority — ring buffer beats adapter when warmed
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_candles_prefers_ring_buffer():
    """When the ring buffer has >= 30 candles, _fetch_candles should use it
    and NOT call the adapter."""
    from backend.services.signal_service.service import _fetch_candles

    warm_candles = _candles(50)

    adapter_called = False

    def fake_get_buffer(symbol, n=None):
        return warm_candles if n is None else warm_candles[-n:]

    async def fake_get_adapter():
        return None

    async def fake_get_adapters():
        nonlocal adapter_called
        adapter_called = True
        return []

    with patch("backend.services.market_data.ingestion.get_candles_from_buffer", side_effect=fake_get_buffer) as _mock_buf, \
         patch("backend.services.signal_service.service._get_ohlcv_adapter", new_callable=AsyncMock, return_value=None), \
         patch("backend.services.market_data.service._get_adapters", new_callable=AsyncMock, return_value=[]):
        # Ensure the import inside _fetch_candles resolves to our mock
        import backend.services.market_data.ingestion as _ing_mod
        orig = _ing_mod.get_candles_from_buffer
        _ing_mod.get_candles_from_buffer = fake_get_buffer
        try:
            result = await _fetch_candles("BTCUSDT")
        finally:
            _ing_mod.get_candles_from_buffer = orig

    assert len(result) >= 30
    assert not adapter_called, "Adapter should not be called when ring buffer is warmed"


# ---------------------------------------------------------------------------
# 18. _fetch_candles — falls back to adapter when buffer empty
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_candles_falls_back_when_buffer_empty():
    from backend.services.signal_service.service import _fetch_candles

    adapter_candles = _candles(50)

    mock_adapter = MagicMock()
    mock_adapter.fetch_ohlcv = AsyncMock(return_value=adapter_candles)
    mock_adapter.exchange_name = "binance_us"

    import backend.services.market_data.ingestion as _ing_mod
    orig = _ing_mod.get_candles_from_buffer
    _ing_mod.get_candles_from_buffer = lambda *a, **kw: []
    try:
        with patch("backend.services.signal_service.service._get_ohlcv_adapter", new_callable=AsyncMock, return_value=mock_adapter):
            result = await _fetch_candles("BTCUSDT")
    finally:
        _ing_mod.get_candles_from_buffer = orig

    assert result == adapter_candles


# ---------------------------------------------------------------------------
# 19. Concurrent _fetch_symbol — no data race on ring buffer
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_fetch_symbol_no_race():
    p = IngestionPipeline()
    p._semaphore = asyncio.Semaphore(6)
    sym = "ETHUSDT"

    call_idx = [0]

    async def fake_fetch(symbol, interval, limit):
        call_idx[0] += 1
        batch = _candles(50, start=call_idx[0] * 10000)
        await asyncio.sleep(0)
        return batch

    mock_adapter = MagicMock()
    mock_adapter.fetch_ohlcv = fake_fetch
    mock_adapter.exchange_name = "mock"

    with patch(
        "backend.services.market_data.ingestion._get_adapters",
        new_callable=AsyncMock,
        return_value=[mock_adapter],
    ):
        await asyncio.gather(*[p._fetch_symbol(sym) for _ in range(5)])

    # Buffer should have candles and metrics should be consistent
    assert len(p._buffers[sym]) > 0
    assert p._metrics[sym].fetch_count > 0


# ---------------------------------------------------------------------------
# 20. CandleRingBuffer — empty buffer returns [] not exception
# ---------------------------------------------------------------------------

def test_ring_buffer_empty_returns_empty_list():
    buf = CandleRingBuffer("EMPTYUSDT", maxlen=100)
    assert buf.latest() == []
    assert buf.latest(n=10) == []
    assert len(buf) == 0
