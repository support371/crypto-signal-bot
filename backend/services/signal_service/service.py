# backend/services/signal_service/service.py
"""
Signal service — orchestrates candle fetching, signal evaluation,
DB persistence, and in-process caching.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Dict, List, Optional

from backend.logic.signal_engine import SignalRecord, evaluate_symbol
from backend.services.market_data.service import get_price

log = logging.getLogger(__name__)

_SYMBOLS: List[str] = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "XRPUSDT", "DOGEUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT",
]
_TIMEFRAME     = "1h"
_CANDLE_LIMIT  = 220
_EVAL_INTERVAL = 60
_TTL_SECONDS   = 900

_signal_cache: Dict[str, SignalRecord] = {}
_last_eval:    Dict[str, float]        = {}
_running = False


# Module-level singleton for OHLCV fetching
_ohlcv_adapter = None
_ohlcv_adapter_lock = None


def _get_ohlcv_lock():
    global _ohlcv_adapter_lock
    if _ohlcv_adapter_lock is None:
        _ohlcv_adapter_lock = asyncio.Lock()
    return _ohlcv_adapter_lock


async def _get_ohlcv_adapter():
    """
    Return a BinanceUsOhlcvAdapter singleton.
    Falls back to the generic market-data adapter chain on import failure.
    """
    global _ohlcv_adapter
    async with _get_ohlcv_lock():
        if _ohlcv_adapter is None:
            try:
                from backend.adapters.exchanges.binance_us_ohlcv import BinanceUsOhlcvAdapter
                _ohlcv_adapter = BinanceUsOhlcvAdapter(paper=True)
                log.info("[signal_service] OHLCV adapter: BinanceUsOhlcvAdapter")
            except Exception as exc:
                log.warning("[signal_service] BinanceUsOhlcvAdapter unavailable (%s) — using generic chain", exc)
                _ohlcv_adapter = None
    return _ohlcv_adapter


async def _fetch_candles(symbol: str, limit: int = _CANDLE_LIMIT):
    """
    Fetch OHLCV candles with a priority chain:
      1. BinanceUsOhlcvAdapter  — real historical candles (preferred)
      2. Generic market-data adapter chain  — fallback
    """
    # 1. Try Binance.US dedicated OHLCV adapter first
    try:
        adapter = await _get_ohlcv_adapter()
        if adapter is not None:
            candles = await adapter.fetch_ohlcv(symbol, _TIMEFRAME, limit)
            if candles and len(candles) >= 2:
                log.debug("[signal_service] %s: %d candles from BinanceUsOhlcvAdapter",
                          symbol, len(candles))
                return candles
            elif candles:
                log.debug("[signal_service] %s: only %d candles — trying fallback",
                          symbol, len(candles))
    except Exception as exc:
        log.debug("[signal_service] BinanceUsOhlcvAdapter failed for %s: %s — trying fallback", symbol, exc)

    # 2. Fallback: generic adapter chain (CoinGecko synthetic candles)
    try:
        from backend.services.market_data.service import _get_adapters
        adapters = await _get_adapters()
        for adapter in adapters:
            try:
                candles = await adapter.fetch_ohlcv(symbol, _TIMEFRAME, limit)
                if candles:
                    return candles
            except Exception:
                continue
    except Exception as exc:
        log.warning("fetch_candles(%s): %s", symbol, exc)
    return []


async def evaluate_signal(symbol: str) -> SignalRecord:
    candles = await _fetch_candles(symbol)

    try:
        snapshot = await get_price(symbol)
        current_price = float(snapshot.price)
    except Exception:
        current_price = 0.0

    if not candles or current_price <= 0:
        import uuid
        now = int(time.time())
        rec = SignalRecord(
            id=str(uuid.uuid4()), symbol=symbol, timeframe=_TIMEFRAME,
            side="FLAT", entry_price=current_price,
            stop_loss=None, take_profit=None,
            confidence=0.0, strategy_id="no_data",
            created_at=now, valid_until=now + _TTL_SECONDS,
            metadata={"reason": "no candle data or price unavailable"},
        )
        _signal_cache[symbol] = rec
        return rec

    closes = [float(c.close) for c in candles]
    highs  = [float(c.high)  for c in candles]
    lows   = [float(c.low)   for c in candles]

    record = evaluate_symbol(
        symbol=symbol, timeframe=_TIMEFRAME,
        closes=closes, highs=highs, lows=lows,
        current_price=current_price, signal_ttl_seconds=_TTL_SECONDS,
    )

    _signal_cache[symbol] = record
    _last_eval[symbol]    = time.time()
    await _persist_signal(record)

    log.info("[signal] %s → %s  conf=%.2f  strategy=%s",
             symbol, record.side, record.confidence, record.strategy_id)
    return record


async def _persist_signal(record: SignalRecord) -> None:
    try:
        from backend.db.session import get_session
        from backend.db.models import SignalRecord as DBSignal
        async with get_session() as session:
            row = DBSignal(
                id=record.id, symbol=record.symbol, timeframe=record.timeframe,
                side=record.side, entry_price=record.entry_price,
                stop_loss=record.stop_loss, take_profit=record.take_profit,
                confidence=record.confidence, strategy_id=record.strategy_id,
                created_at=record.created_at, valid_until=record.valid_until,
                metadata_json=json.dumps(record.metadata),
            )
            session.add(row)
            await session.commit()
    except Exception as exc:
        log.debug("signal persist error (non-fatal): %s", exc)


def get_cached_signal(symbol: str) -> Optional[SignalRecord]:
    return _signal_cache.get(symbol.upper())


def get_all_cached_signals() -> List[SignalRecord]:
    return list(_signal_cache.values())


def get_signal_service_status() -> dict:
    return {
        "running":         _running,
        "cached_symbols":  list(_signal_cache.keys()),
        "tracked_symbols": len(_SYMBOLS),
        "eval_interval":   _EVAL_INTERVAL,
        "last_eval":       {s: int(t) for s, t in _last_eval.items()},
    }


async def _eval_loop() -> None:
    global _running
    _running = True
    log.info("[signal_service] loop started — %d symbols", len(_SYMBOLS))
    while True:
        for symbol in _SYMBOLS:
            try:
                await evaluate_signal(symbol)
            except Exception as exc:
                log.warning("[signal_service] %s: %s", symbol, exc)
            await asyncio.sleep(0.5)
        await asyncio.sleep(_EVAL_INTERVAL)


def start_signal_service(app) -> None:
    # Direct task creation — called from lifespan() which is already async
    asyncio.create_task(_eval_loop())
