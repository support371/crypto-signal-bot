# backend/replay/replayer.py
"""
Deterministic signal replayer.

Given a sequence of historical OHLCV candles, the Replayer re-runs the
signal engine's indicator calculation and strategy evaluation, producing
a ReplayResult that can be compared against the original live run.

Purpose:
  - Verify that signal generation is deterministic (same input → same output).
  - Audit past decisions: "why did the signal flip BUY at 14:00?"
  - Regression testing: any indicator change must not alter replay results for
    previously seen candle sequences.

Usage:
    from backend.replay.replayer import Replayer
    replayer = Replayer()
    result = replayer.replay(symbol="BTCUSDT", candles=candle_list)
    assert result.deterministic

API:
    replay(symbol, candles, strategy_id?)   → ReplayResult
    replay_from_file(path)                  → ReplayResult
    diff(result_a, result_b)                → list[str] diffs

Determinism guarantee:
    Two Replayer instances, given identical candles, MUST produce identical
    signal sequences. This is enforced by the test suite.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional

from backend.logic.indicators import (
    last_atr as compute_atr,
    last_bollinger as _last_bollinger,
    last_ema as compute_ema,
    last_macd as _last_macd,
    last_rsi as compute_rsi,
)

def compute_macd(closes):
    from backend.logic.indicators import last_macd
    return last_macd(closes)   # already returns (macd_line, signal_line, histogram)

def compute_bollinger_bands(closes):
    from backend.logic.indicators import last_bollinger
    return last_bollinger(closes)   # already returns (upper, middle, lower)



# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ReplayCandle:
    """Minimal OHLCV candle for replay input."""
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ReplayCandle":
        return cls(
            timestamp=float(d["timestamp"]),
            open=float(d["open"]),
            high=float(d["high"]),
            low=float(d["low"]),
            close=float(d["close"]),
            volume=float(d["volume"]),
        )


@dataclass
class ReplaySignal:
    """Signal generated at one point in the replay sequence."""
    timestamp: float
    side: str          # "BUY" | "SELL" | "FLAT"
    confidence: float
    strategy_id: str
    indicators: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "side": self.side,
            "confidence": round(self.confidence, 6),
            "strategy_id": self.strategy_id,
            "indicators": self.indicators,
        }


@dataclass
class ReplayResult:
    """Full result of a replay run."""
    symbol: str
    candle_count: int
    signals: List[ReplaySignal]
    input_hash: str         # SHA-256 of the candle input — for determinism checks
    output_hash: str        # SHA-256 of the signal output — for regression checks
    deterministic: bool     # True if two runs on the same input produced the same output_hash
    elapsed_ms: float
    strategy_id: str
    replay_ts: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "candle_count": self.candle_count,
            "signal_count": len(self.signals),
            "signals": [s.to_dict() for s in self.signals],
            "input_hash": self.input_hash,
            "output_hash": self.output_hash,
            "deterministic": self.deterministic,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "strategy_id": self.strategy_id,
            "replay_ts": self.replay_ts,
        }


# ---------------------------------------------------------------------------
# Indicator computation helpers
# ---------------------------------------------------------------------------

def _closes(candles: List[ReplayCandle]) -> List[Decimal]:
    return [Decimal(str(c.close)) for c in candles]


def _compute_indicators(candles: List[ReplayCandle]) -> Dict[str, Any]:
    """Run all indicator calculations on the candle sequence."""
    closes_dec = _closes(candles)
    closes = [float(c) for c in closes_dec]
    if len(closes) < 26:
        return {}

    rsi = compute_rsi(closes, period=14)
    ema20 = compute_ema(closes, period=20)
    ema50 = compute_ema(closes, period=50)
    ema200 = compute_ema(closes, period=200)
    macd_line, signal_line, histogram = compute_macd(closes)
    bb_upper, bb_mid, bb_lower = compute_bollinger_bands(closes)
    highs = [float(c.high) for c in candles]
    lows = [float(c.low) for c in candles]
    atr = compute_atr(highs, lows, closes, period=14)

    return {
        "rsi": float(rsi) if rsi is not None else None,
        "ema20": float(ema20) if ema20 is not None else None,
        "ema50": float(ema50) if ema50 is not None else None,
        "ema200": float(ema200) if ema200 is not None else None,
        "macd_line": float(macd_line) if macd_line is not None else None,
        "macd_signal": float(signal_line) if signal_line is not None else None,
        "macd_hist": float(histogram) if histogram is not None else None,
        "bb_upper": float(bb_upper) if bb_upper is not None else None,
        "bb_mid": float(bb_mid) if bb_mid is not None else None,
        "bb_lower": float(bb_lower) if bb_lower is not None else None,
        "atr": float(atr) if atr is not None else None,
    }


# ---------------------------------------------------------------------------
# Signal classification (deterministic, no randomness)
# ---------------------------------------------------------------------------

def _classify_trend(indicators: Dict[str, Any], close: float) -> tuple[str, float]:
    """EMA crossover trend-following strategy. Returns (side, confidence)."""
    ema20 = indicators.get("ema20")
    ema50 = indicators.get("ema50")
    ema200 = indicators.get("ema200")
    if ema20 is None or ema50 is None:
        return "FLAT", 0.0

    confidence = 0.0
    if ema20 > ema50:
        confidence += 0.4
    if ema200 and ema50 > ema200:
        confidence += 0.2
    if ema200 and close > ema200:
        confidence += 0.1
    macd_hist = indicators.get("macd_hist")
    if macd_hist and macd_hist > 0:
        confidence += 0.1
    rsi = indicators.get("rsi")
    if rsi and 45 < rsi < 70:
        confidence += 0.1

    if ema20 > ema50:
        return "BUY", min(confidence, 1.0)
    else:
        return "SELL", min(0.5, 1.0 - confidence)


def _classify_mean_reversion(indicators: Dict[str, Any], close: float) -> tuple[str, float]:
    """RSI + Bollinger mean-reversion strategy."""
    rsi = indicators.get("rsi")
    bb_lower = indicators.get("bb_lower")
    bb_upper = indicators.get("bb_upper")
    if rsi is None or bb_lower is None:
        return "FLAT", 0.0

    if rsi < 30 and close <= bb_lower:
        confidence = 0.6 + max(0.0, (30 - rsi) / 30 * 0.3)
        return "BUY", min(confidence, 0.95)
    if rsi > 70 and close >= bb_upper:
        confidence = 0.6 + max(0.0, (rsi - 70) / 30 * 0.3)
        return "SELL", min(confidence, 0.95)
    return "FLAT", 0.0


def _classify_momentum(indicators: Dict[str, Any]) -> tuple[str, float]:
    """MACD momentum strategy."""
    macd_line = indicators.get("macd_line")
    macd_signal = indicators.get("macd_signal")
    macd_hist = indicators.get("macd_hist")
    rsi = indicators.get("rsi")
    if macd_line is None or macd_signal is None:
        return "FLAT", 0.0

    confidence = 0.0
    if macd_line > macd_signal:
        confidence += 0.4
        if macd_hist and macd_hist > 0:
            confidence += 0.2
        if rsi and 40 < rsi < 65:
            confidence += 0.15
        return "BUY", min(confidence, 0.9)
    else:
        confidence += 0.35
        if macd_hist and macd_hist < 0:
            confidence += 0.2
        if rsi and rsi > 55:
            confidence += 0.15
        return "SELL", min(confidence, 0.85)


_STRATEGIES = {
    "trend_v1": _classify_trend,
    "mean_reversion_v1": _classify_mean_reversion,
    "momentum_v1": _classify_momentum,
}


def _classify(strategy_id: str, indicators: Dict[str, Any], close: float) -> tuple[str, float]:
    fn = _STRATEGIES.get(strategy_id)
    if fn is None:
        return "FLAT", 0.0
    if strategy_id == "momentum_v1":
        return fn(indicators)  # type: ignore
    return fn(indicators, close)  # type: ignore


# ---------------------------------------------------------------------------
# Hashing helpers
# ---------------------------------------------------------------------------

def _hash_candles(candles: List[ReplayCandle]) -> str:
    data = json.dumps(
        [{"ts": c.timestamp, "o": c.open, "h": c.high, "l": c.low, "c": c.close, "v": c.volume}
         for c in candles],
        sort_keys=True,
    )
    return hashlib.sha256(data.encode()).hexdigest()


def _hash_signals(signals: List[ReplaySignal]) -> str:
    data = json.dumps(
        [{"ts": s.timestamp, "side": s.side, "confidence": round(s.confidence, 6), "strat": s.strategy_id}
         for s in signals],
        sort_keys=True,
    )
    return hashlib.sha256(data.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Replayer class
# ---------------------------------------------------------------------------

class Replayer:
    """
    Deterministic signal replayer.

    Stateless: every call to replay() is independent. Two Replayer instances
    with the same candle input MUST produce the same output_hash.
    """

    DEFAULT_STRATEGY = "trend_v1"
    MIN_CANDLES = 26  # minimum for MACD(12,26,9)

    def replay(
        self,
        symbol: str,
        candles: List[ReplayCandle],
        strategy_id: Optional[str] = None,
    ) -> ReplayResult:
        """
        Replay signal generation on the given candle sequence.

        Args:
            symbol:      e.g. "BTCUSDT"
            candles:     List[ReplayCandle] sorted oldest-first
            strategy_id: one of trend_v1 | mean_reversion_v1 | momentum_v1

        Returns:
            ReplayResult with signals list and determinism hash.
        """
        t0 = time.perf_counter()
        strategy_id = strategy_id or self.DEFAULT_STRATEGY
        input_hash = _hash_candles(candles)

        signals: List[ReplaySignal] = []

        # Minimum warmup: need at least MIN_CANDLES before we can produce a signal
        if len(candles) < self.MIN_CANDLES:
            return ReplayResult(
                symbol=symbol,
                candle_count=len(candles),
                signals=[],
                input_hash=input_hash,
                output_hash=_hash_signals([]),
                deterministic=True,
                elapsed_ms=(time.perf_counter() - t0) * 1000,
                strategy_id=strategy_id,
            )

        # Walk through the candle sequence, expanding the window
        for i in range(self.MIN_CANDLES, len(candles) + 1):
            window = candles[:i]
            indicators = _compute_indicators(window)
            if not indicators:
                continue
            current_close = window[-1].close
            side, confidence = _classify(strategy_id, indicators, current_close)
            signals.append(
                ReplaySignal(
                    timestamp=window[-1].timestamp,
                    side=side,
                    confidence=confidence,
                    strategy_id=strategy_id,
                    indicators=indicators,
                )
            )

        output_hash = _hash_signals(signals)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        # Verify determinism by running twice and comparing output hashes
        # (second run on same data must match first run)
        signals2: List[ReplaySignal] = []
        for i in range(self.MIN_CANDLES, len(candles) + 1):
            window = candles[:i]
            indicators = _compute_indicators(window)
            if not indicators:
                continue
            current_close = window[-1].close
            side, confidence = _classify(strategy_id, indicators, current_close)
            signals2.append(
                ReplaySignal(
                    timestamp=window[-1].timestamp,
                    side=side,
                    confidence=confidence,
                    strategy_id=strategy_id,
                )
            )
        output_hash2 = _hash_signals(signals2)
        deterministic = (output_hash == output_hash2)

        return ReplayResult(
            symbol=symbol,
            candle_count=len(candles),
            signals=signals,
            input_hash=input_hash,
            output_hash=output_hash,
            deterministic=deterministic,
            elapsed_ms=elapsed_ms,
            strategy_id=strategy_id,
        )

    def replay_from_dict(
        self,
        data: Dict[str, Any],
    ) -> ReplayResult:
        """Replay from a dict with keys: symbol, candles, strategy_id."""
        symbol = data.get("symbol", "UNKNOWN")
        strategy_id = data.get("strategy_id", self.DEFAULT_STRATEGY)
        candles = [ReplayCandle.from_dict(c) for c in data.get("candles", [])]
        return self.replay(symbol=symbol, candles=candles, strategy_id=strategy_id)

    def diff(self, result_a: ReplayResult, result_b: ReplayResult) -> List[str]:
        """
        Compare two ReplayResults and return a list of differences.
        Empty list means the results are identical.
        """
        diffs = []
        if result_a.input_hash != result_b.input_hash:
            diffs.append(f"input_hash differs: {result_a.input_hash[:8]} vs {result_b.input_hash[:8]}")
        if result_a.output_hash != result_b.output_hash:
            diffs.append(f"output_hash differs: {result_a.output_hash[:8]} vs {result_b.output_hash[:8]}")
        if len(result_a.signals) != len(result_b.signals):
            diffs.append(
                f"signal_count differs: {len(result_a.signals)} vs {len(result_b.signals)}"
            )
        elif result_a.signals and result_b.signals:
            for i, (sa, sb) in enumerate(zip(result_a.signals, result_b.signals)):
                if sa.side != sb.side or round(sa.confidence, 6) != round(sb.confidence, 6):
                    diffs.append(
                        f"signal[{i}] differs: "
                        f"{sa.side}/{sa.confidence:.4f} vs {sb.side}/{sb.confidence:.4f}"
                    )
                    if len(diffs) >= 5:
                        diffs.append("... (truncated)")
                        break
        return diffs
