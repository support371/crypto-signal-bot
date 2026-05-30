# backend/logic/strategies.py
"""
Strategy evaluation engine — V1.

Three strategies:
  1. trend_follow  — EMA cross (20/50/200) + RSI filter
  2. mean_reversion — RSI + Bollinger Bands
  3. momentum       — MACD cross

Each strategy returns a StrategyResult dataclass.
The signal engine combines them using a confidence-weighted vote.

All functions accept pre-computed indicator snapshots (plain dicts)
so they can be unit-tested without candle history.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class StrategyResult:
    strategy_id:  str
    side:         str           # "BUY" | "SELL" | "FLAT"
    confidence:   float         # 0.0 – 1.0
    reasons:      List[str]     = field(default_factory=list)
    tags:         List[str]     = field(default_factory=list)


# ---------------------------------------------------------------------------
# Strategy 1 — Trend-following (EMA cross)
# ---------------------------------------------------------------------------

def trend_follow(
    ema20: Optional[float],
    ema50: Optional[float],
    ema200: Optional[float],
    rsi14: Optional[float],
) -> StrategyResult:
    """
    BUY  when EMA20 > EMA50 > EMA200 and RSI < 70
    SELL when EMA20 < EMA50 < EMA200 and RSI > 30
    FLAT otherwise
    """
    sid = "trend_follow"

    if any(v is None for v in [ema20, ema50, ema200, rsi14]):
        return StrategyResult(sid, "FLAT", 0.0, ["insufficient data"])

    bull_stack = ema20 > ema50 > ema200  # type: ignore[operator]
    bear_stack = ema20 < ema50 < ema200  # type: ignore[operator]

    if bull_stack and rsi14 < 70:
        # Scale confidence by how far RSI is from overbought
        conf = 0.55 + min((70 - rsi14) / 100, 0.25)  # 0.55 – 0.80
        return StrategyResult(
            sid, "BUY", round(conf, 3),
            reasons=[f"EMA20({ema20:.2f})>EMA50({ema50:.2f})>EMA200({ema200:.2f})",
                     f"RSI={rsi14:.1f}<70"],
            tags=["trend", "ema_cross", "bullish"],
        )

    if bear_stack and rsi14 > 30:
        conf = 0.55 + min((rsi14 - 30) / 100, 0.25)
        return StrategyResult(
            sid, "SELL", round(conf, 3),
            reasons=[f"EMA20({ema20:.2f})<EMA50({ema50:.2f})<EMA200({ema200:.2f})",
                     f"RSI={rsi14:.1f}>30"],
            tags=["trend", "ema_cross", "bearish"],
        )

    return StrategyResult(sid, "FLAT", 0.1, reasons=["no EMA alignment"], tags=["flat"])


# ---------------------------------------------------------------------------
# Strategy 2 — Mean-reversion (RSI + Bollinger Bands)
# ---------------------------------------------------------------------------

def mean_reversion(
    rsi14: Optional[float],
    price: Optional[float],
    bb_upper: Optional[float],
    bb_lower: Optional[float],
    bb_mid: Optional[float],
) -> StrategyResult:
    """
    BUY  when RSI < 30 and price near or below lower band
    SELL when RSI > 70 and price near or above upper band
    """
    sid = "mean_reversion"

    if any(v is None for v in [rsi14, price, bb_upper, bb_lower, bb_mid]):
        return StrategyResult(sid, "FLAT", 0.0, ["insufficient data"])

    band_width = bb_upper - bb_lower  # type: ignore[operator]
    if band_width <= 0:
        return StrategyResult(sid, "FLAT", 0.0, ["zero band width"])

    # Price position within bands: 0 = at lower, 1 = at upper
    pos = (price - bb_lower) / band_width  # type: ignore[operator]

    oversold  = rsi14 < 30 and pos < 0.25   # type: ignore[operator]
    overbought = rsi14 > 70 and pos > 0.75  # type: ignore[operator]

    if oversold:
        # Higher confidence the more oversold + the closer to lower band
        rsi_factor = (30 - rsi14) / 30      # type: ignore[operator]
        pos_factor = (0.25 - pos) / 0.25
        conf = 0.50 + 0.30 * (rsi_factor + pos_factor) / 2
        return StrategyResult(
            sid, "BUY", round(min(conf, 0.85), 3),
            reasons=[f"RSI={rsi14:.1f}<30", f"price({price:.2f}) near lower BB({bb_lower:.2f})"],
            tags=["mean_reversion", "oversold", "bollinger"],
        )

    if overbought:
        rsi_factor = (rsi14 - 70) / 30     # type: ignore[operator]
        pos_factor = (pos - 0.75) / 0.25
        conf = 0.50 + 0.30 * (rsi_factor + pos_factor) / 2
        return StrategyResult(
            sid, "SELL", round(min(conf, 0.85), 3),
            reasons=[f"RSI={rsi14:.1f}>70", f"price({price:.2f}) near upper BB({bb_upper:.2f})"],
            tags=["mean_reversion", "overbought", "bollinger"],
        )

    return StrategyResult(sid, "FLAT", 0.1,
                          reasons=["RSI and price within normal bands"], tags=["flat"])


# ---------------------------------------------------------------------------
# Strategy 3 — Momentum (MACD cross)
# ---------------------------------------------------------------------------

def momentum(
    macd_line: Optional[float],
    signal_line: Optional[float],
    histogram: Optional[float],
    prev_macd_line: Optional[float],
    prev_signal_line: Optional[float],
) -> StrategyResult:
    """
    BUY  when MACD crosses above signal line (bullish crossover)
    SELL when MACD crosses below signal line (bearish crossover)
    Histogram magnitude scales confidence.
    """
    sid = "momentum"

    if any(v is None for v in [macd_line, signal_line, histogram,
                                prev_macd_line, prev_signal_line]):
        return StrategyResult(sid, "FLAT", 0.0, ["insufficient data"])

    # Cross detection
    bullish_cross = (prev_macd_line < prev_signal_line and   # type: ignore[operator]
                     macd_line > signal_line)                 # type: ignore[operator]
    bearish_cross = (prev_macd_line > prev_signal_line and   # type: ignore[operator]
                     macd_line < signal_line)                 # type: ignore[operator]

    # Ongoing momentum (no fresh cross but aligned)
    bull_aligned = macd_line > signal_line and histogram > 0  # type: ignore[operator]
    bear_aligned = macd_line < signal_line and histogram < 0  # type: ignore[operator]

    # Confidence: fresh cross = higher, ongoing = lower
    hist_mag = min(abs(histogram) / max(abs(macd_line), 1e-9), 1.0)  # type: ignore[arg-type]

    if bullish_cross:
        conf = 0.65 + 0.15 * hist_mag
        return StrategyResult(
            sid, "BUY", round(conf, 3),
            reasons=[f"MACD({macd_line:.4f}) crossed above signal({signal_line:.4f})"],
            tags=["momentum", "macd_cross", "bullish"],
        )
    if bearish_cross:
        conf = 0.65 + 0.15 * hist_mag
        return StrategyResult(
            sid, "SELL", round(conf, 3),
            reasons=[f"MACD({macd_line:.4f}) crossed below signal({signal_line:.4f})"],
            tags=["momentum", "macd_cross", "bearish"],
        )
    if bull_aligned:
        conf = 0.40 + 0.15 * hist_mag
        return StrategyResult(
            sid, "BUY", round(conf, 3),
            reasons=[f"MACD above signal (aligned)"],
            tags=["momentum", "bullish", "continuation"],
        )
    if bear_aligned:
        conf = 0.40 + 0.15 * hist_mag
        return StrategyResult(
            sid, "SELL", round(conf, 3),
            reasons=[f"MACD below signal (aligned)"],
            tags=["momentum", "bearish", "continuation"],
        )

    return StrategyResult(sid, "FLAT", 0.1, reasons=["no MACD signal"], tags=["flat"])


# ---------------------------------------------------------------------------
# Signal combiner — weighted confidence vote
# ---------------------------------------------------------------------------

def combine_strategies(results: List[StrategyResult]) -> Dict[str, Any]:
    """
    Combine multiple strategy results into a single signal via
    confidence-weighted voting.

    Returns dict with: side, confidence, strategy_votes, reasons, tags
    """
    buy_weight  = 0.0
    sell_weight = 0.0
    flat_weight = 0.0

    for r in results:
        if r.side == "BUY":
            buy_weight  += r.confidence
        elif r.side == "SELL":
            sell_weight += r.confidence
        else:
            flat_weight += r.confidence

    total = buy_weight + sell_weight + flat_weight or 1.0

    if buy_weight >= sell_weight and buy_weight > flat_weight:
        side = "BUY"
        raw_conf = buy_weight / total
    elif sell_weight > buy_weight and sell_weight > flat_weight:
        side = "SELL"
        raw_conf = sell_weight / total
    else:
        side = "FLAT"
        raw_conf = flat_weight / total

    # Consensus bonus: if all strategies agree, boost confidence
    agreeing = [r for r in results if r.side == side and r.side != "FLAT"]
    if len(agreeing) == len(results):
        raw_conf = min(raw_conf * 1.15, 0.95)

    all_reasons = [r for result in results for r in result.reasons]
    all_tags    = list({t for result in results for t in result.tags})

    return {
        "side":       side,
        "confidence": round(raw_conf, 4),
        "strategy_votes": {r.strategy_id: {"side": r.side, "confidence": r.confidence}
                           for r in results},
        "reasons":    all_reasons,
        "tags":       all_tags,
    }
