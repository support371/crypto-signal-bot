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
    ema,
    rsi,
    macd,
    bollinger_bands,
    atr,
)

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
    rsi_val = indicators.get("rsi")
    if rsi_val and 45 < rsi_val < 70:
        confidence += 0.1

    if ema20 > ema50:
        return "BUY", min(confidence, 1.0)
    else:
        return "SELL", min(0.5, 1.0 - confidence)


def _classify_mean_reversion(indicators: Dict[str, Any], close: float) -> tuple[str, float]:
    """RSI + Bollinger mean-reversion strategy."""
    rsi_val = indicators.get("rsi")
    bb_lower = indicators.get("bb_lower")
    bb_upper = indicators.get("bb_upper")
    if rsi_val is None or bb_lower is None:
        return "FLAT", 0.0

    if rsi_val < 30 and close <= bb_lower:
        confidence = 0.6 + max(0.0, (30 - rsi_val) / 30 * 0.3)
        return "BUY", min(confidence, 0.95)
    if rsi_val > 70 and close >= bb_upper:
        confidence = 0.6 + max(0.0, (rsi_val - 70) / 30 * 0.3)
        return "SELL", min(confidence, 0.95)
    return "FLAT", 0.0


def _classify_momentum(indicators: Dict[str, Any]) -> tuple[str, float]:
    """MACD momentum strategy."""
    macd_line = indicators.get("macd_line")
    macd_signal = indicators.get("macd_signal")
    macd_hist = indicators.get("macd_hist")
    rsi_val = indicators.get("rsi")
    if macd_line is None or macd_signal is None:
        return "FLAT", 0.0

    confidence = 0.0
    if macd_line > macd_signal:
        confidence += 0.4
        if macd_hist and macd_hist > 0:
            confidence += 0.2
        if rsi_val and 40 < rsi_val < 65:
            confidence += 0.15
        return "BUY", min(confidence, 0.9)
    else:
        confidence += 0.35
        if macd_hist and macd_hist < 0:
            confidence += 0.2
        if rsi_val and rsi_val > 55:
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

    def _run_replay_logic(
        self,
        symbol: str,
        candles: List[ReplayCandle],
        strategy_id: str,
        include_indicators: bool = True
    ) -> List[ReplaySignal]:
        """
        Internal implementation of replay logic, optimized to O(N).
        Pre-computes all indicators in full series instead of sliding window.
        """
        if len(candles) < self.MIN_CANDLES:
            return []

        # Optimization: Pre-extract price lists once
        closes = [float(c.close) for c in candles]
        highs  = [float(c.high) for c in candles]
        lows   = [float(c.low)  for c in candles]

        # Optimization: Pre-compute full indicator series in O(N)
        # instead of O(N^2) sliding window calls.
        rsi_series = rsi(closes, 14)
        ema20_series = ema(closes, 20)
        ema50_series = ema(closes, 50)
        ema200_series = ema(closes, 200)
        macd_l_series, sig_l_series, hist_series = macd(closes)
        bb_u_series, bb_m_series, bb_l_series = bollinger_bands(closes)
        atr_series = atr(highs, lows, closes, 14)

        signals: List[ReplaySignal] = []

        # Walk through candles and use pre-computed indicator values
        for i in range(self.MIN_CANDLES - 1, len(candles)):
            indicator_snap = {
                "rsi": rsi_series[i],
                "ema20": ema20_series[i],
                "ema50": ema50_series[i],
                "ema200": ema200_series[i],
                "macd_line": macd_l_series[i],
                "macd_signal": sig_l_series[i],
                "macd_hist": hist_series[i],
                "bb_upper": bb_u_series[i],
                "bb_mid": bb_m_series[i],
                "bb_lower": bb_l_series[i],
                "atr": atr_series[i],
            }

            # Strategy logic requires current close
            current_close = closes[i]
            side, confidence = _classify(strategy_id, indicator_snap, current_close)

            signals.append(
                ReplaySignal(
                    timestamp=candles[i].timestamp,
                    side=side,
                    confidence=confidence,
                    strategy_id=strategy_id,
                    indicators=indicator_snap if include_indicators else {},
                )
            )

        return signals

    def replay(
        self,
        symbol: str,
        candles: List[ReplayCandle],
        strategy_id: Optional[str] = None,
    ) -> ReplayResult:
        """
        Replay signal generation on the given candle sequence.
        Optimized to O(N) by utilizing full-series technical indicator functions.
        """
        t0 = time.perf_counter()
        strategy_id = strategy_id or self.DEFAULT_STRATEGY
        input_hash = _hash_candles(candles)

        # 1. Run replay logic
        signals = self._run_replay_logic(symbol, candles, strategy_id, include_indicators=True)

        output_hash = _hash_signals(signals)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        # 2. Verify determinism by running again (O(N) check instead of O(N^2))
        signals2 = self._run_replay_logic(symbol, candles, strategy_id, include_indicators=False)
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
