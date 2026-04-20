# backend/services/prediction_bot/service.py
"""
PHASE 7 — Prediction Service.

Extracts signal orchestration into its own service package.
Feeds exclusively from the Phase 6 MarketDataService (no synthetic price input).
Publishes signal results to Redis for GET /signal/latest and WebSocket.

PROTECTED FILES — NOT IMPORTED HERE:
  - backend/logic/signals.py   (signal generation logic)
  - backend/logic/features.py  (feature computation)
  - backend/logic/risk.py      (risk evaluation)

This service wraps those protected modules via their public function interfaces
only. If those interfaces need to change for extraction, the minimum necessary
import shim is used (documented below).

INTERFACE CONTRACT:
  The protected signal logic is expected to expose:
    compute_signal(market_state: dict) -> SignalOutput
    compute_features(ticker: dict) -> FeaturesOutput

  If these functions don't exist yet, this service falls back to a
  NOT_AVAILABLE state — never to synthetic/mock signals.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from backend.config.loader import get_redis_config
from backend.services.market_data.service import (
    MarketDataUnavailable,
    get_price,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Signal output type
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SignalOutput:
    symbol:     str
    direction:  str         # "UP" | "DOWN" | "NEUTRAL"
    confidence: float       # 0–100
    regime:     str         # "TREND" | "RANGE" | "CHAOS"
    horizon:    int         # minutes
    available:  bool        # False when signal engine is unavailable
    source:     str         # "signal_engine" | "unavailable"
    computed_at: int        # unix seconds
    reasoning:  Optional[str] = None


UNAVAILABLE_SIGNAL = SignalOutput(
    symbol="",
    direction="NEUTRAL",
    confidence=0.0,
    regime="CHAOS",
    horizon=0,
    available=False,
    source="unavailable",
    computed_at=0,
    reasoning="Signal engine not yet wired or market data unavailable.",
)


# ---------------------------------------------------------------------------
# Protected module interface — minimal shim
# ---------------------------------------------------------------------------

def _try_import_signal_engine():
    """
    Attempt to import the protected signal engine.
    Returns (compute_signal, compute_features) or (None, None) if unavailable.
    This is the ONLY place protected logic imports are permitted in this file.
    """
    try:
        from backend.logic import signals as _signals  # type: ignore
        from backend.logic import features as _features  # type: ignore
        return (
            getattr(_signals, "compute_signal", None),
            getattr(_features, "compute_features", None),
        )
    except ImportError:
        return None, None


# ---------------------------------------------------------------------------
# In-process signal cache
# ---------------------------------------------------------------------------

_latest_signals: dict[str, SignalOutput] = {}


# ---------------------------------------------------------------------------
# Redis helpers
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
    except Exception:
        return None


async def _cache_signal(symbol: str, sig: SignalOutput) -> None:
    r = await _get_redis()
    if r:
        try:
            cfg = get_redis_config()
            await r.set(
                f"signal:latest:{symbol}",
                json.dumps({
                    "symbol":      sig.symbol,
                    "direction":   sig.direction,
                    "confidence":  sig.confidence,
                    "regime":      sig.regime,
                    "horizon":     sig.horizon,
                    "available":   sig.available,
                    "source":      sig.source,
                    "computed_at": sig.computed_at,
                    "reasoning":   sig.reasoning,
                }),
                ex=cfg.signal_ttl_seconds,
            )
        except Exception as exc:
            log.warning("Failed to cache signal for %s: %s", symbol, exc)


async def _publish_signal(symbol: str, sig: SignalOutput) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.publish("signal_updates", json.dumps({
                "type":       "signal_update",
                "symbol":     sig.symbol,
                "direction":  sig.direction,
                "confidence": sig.confidence,
                "regime":     sig.regime,
                "available":  sig.available,
                "ts":         sig.computed_at,
            }))
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Core signal computation
# ---------------------------------------------------------------------------

async def compute_signal_for_symbol(symbol: str) -> SignalOutput:
    """
    Compute a signal for a symbol.

    Flow:
      1. Fetch live price from MarketDataService (real data, never synthetic).
      2. Pass to protected signal engine.
      3. Cache result in Redis.
      4. Publish to WebSocket broadcaster.
      5. If engine unavailable: return NOT_AVAILABLE state (never fake signal).

    CHAOS suppression: if the signal engine returns regime=CHAOS,
    direction is forced to NEUTRAL and confidence is capped at 20.
    This is the minimum safe behavior for CHAOS regime (Rule 5: risk overrides strategy).
    """
    now = int(time.time())

    # --- Fetch live market data ---
    try:
        snapshot = await get_price(symbol)
    except MarketDataUnavailable as exc:
        log.warning("Cannot compute signal for %s — market data unavailable: %s", symbol, exc)
        sig = SignalOutput(
            symbol=symbol,
            direction="NEUTRAL",
            confidence=0.0,
            regime="CHAOS",
            horizon=0,
            available=False,
            source="unavailable",
            computed_at=now,
            reasoning=f"Market data unavailable: {exc.reason}",
        )
        _latest_signals[symbol] = sig
        await _cache_signal(symbol, sig)
        return sig

    # --- Try signal engine ---
    compute_signal, compute_features = _try_import_signal_engine()

    if compute_signal is None or compute_features is None:
        log.debug(
            "Signal engine not available for %s — returning NOT_AVAILABLE (not mock)",
            symbol,
        )
        sig = SignalOutput(
            symbol=symbol,
            direction="NEUTRAL",
            confidence=0.0,
            regime="CHAOS",
            horizon=0,
            available=False,
            source="unavailable",
            computed_at=now,
            reasoning="Signal engine module not yet wired. No mock signal substituted.",
        )
        _latest_signals[symbol] = sig
        await _cache_signal(symbol, sig)
        return sig

    # --- Compute features and signal ---
    try:
        market_state = {
            "symbol":    symbol,
            "price":     float(snapshot.price),
            "bid":       float(snapshot.bid),
            "ask":       float(snapshot.ask),
            "spread_pct": snapshot.spread_pct,
            "change24h": snapshot.change24h,
            "volume24h": float(snapshot.volume24h),
            "fetched_at": snapshot.fetched_at,
        }

        features = compute_features(market_state)
        raw_signal = compute_signal(features)

        direction  = raw_signal.get("direction", "NEUTRAL")
        confidence = float(raw_signal.get("confidence", 0.0))
        regime     = raw_signal.get("regime", "RANGE")
        horizon    = int(raw_signal.get("horizon", 15))
        reasoning  = raw_signal.get("reasoning")

        # CHAOS suppression — risk overrides strategy (Rule 5)
        if regime == "CHAOS":
            direction  = "NEUTRAL"
            confidence = min(confidence, 20.0)
            log.info("[prediction] CHAOS regime for %s — direction suppressed", symbol)

        # Confidence threshold — sub-40 signals are not actionable
        if confidence < 40.0:
            direction = "NEUTRAL"

        sig = SignalOutput(
            symbol=symbol,
            direction=direction,
            confidence=confidence,
            regime=regime,
            horizon=horizon,
            available=True,
            source="signal_engine",
            computed_at=now,
            reasoning=reasoning,
        )

    except Exception as exc:
        log.error("Signal engine error for %s: %s", symbol, exc)
        sig = SignalOutput(
            symbol=symbol,
            direction="NEUTRAL",
            confidence=0.0,
            regime="CHAOS",
            horizon=0,
            available=False,
            source="engine_error",
            computed_at=now,
            reasoning=f"Engine error: {exc}",
        )

    _latest_signals[symbol] = sig
    await _cache_signal(symbol, sig)
    await _publish_signal(symbol, sig)
    return sig


async def get_latest_signal(symbol: str) -> SignalOutput:
    """
    Return the latest cached signal for a symbol.
    If no signal is cached: compute one now.
    Never returns a synthetic/fabricated signal.
    """
    if symbol in _latest_signals:
        cached = _latest_signals[symbol]
        # Re-compute if signal is too old (> 2 × horizon)
        age = int(time.time()) - cached.computed_at
        max_age = max(cached.horizon * 60 * 2, 300)
        if age < max_age:
            return cached

    return await compute_signal_for_symbol(symbol)


# ---------------------------------------------------------------------------
# Prediction loop
# ---------------------------------------------------------------------------

_loop_task: Optional[asyncio.Task] = None
_loop_running: bool = False
_TRACKED_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
    "XRPUSDT", "DOTUSDT", "AVAXUSDT", "DOGEUSDT", "LINKUSDT",
]
_LOOP_INTERVAL_SECONDS = 60  # compute signals every 60s


async def _prediction_loop() -> None:
    global _loop_running
    _loop_running = True
    log.info("[prediction] Loop started. Tracking %d symbols.", len(_TRACKED_SYMBOLS))

    while _loop_running:
        cycle_start = time.time()

        tasks = [compute_signal_for_symbol(sym) for sym in _TRACKED_SYMBOLS]
        await asyncio.gather(*tasks, return_exceptions=True)

        elapsed = time.time() - cycle_start
        await asyncio.sleep(max(1.0, _LOOP_INTERVAL_SECONDS - elapsed))

    _loop_running = False
    log.info("[prediction] Loop stopped.")


async def start_prediction_loop() -> None:
    global _loop_task
    if _loop_running:
        return
    _loop_task = asyncio.create_task(_prediction_loop())
    log.info("[prediction] Task created.")


async def stop_prediction_loop() -> None:
    global _loop_running, _loop_task
    _loop_running = False
    if _loop_task and not _loop_task.done():
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
    log.info("[prediction] Stopped cleanly.")


def get_prediction_status() -> dict:
    return {
        "running": _loop_running,
        "cached_symbols": list(_latest_signals.keys()),
        "tracked_symbols": len(_TRACKED_SYMBOLS),
    }
