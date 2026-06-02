# backend/logic/signal_engine.py
"""
Signal engine — orchestrates indicators + strategies → SignalRecord.

Inputs:
  - OHLCV candles (from market data service)
  - Latest price / ATR for SL/TP sizing

Outputs:
  - SignalRecord dataclass (persisted to DB and returned via API)

This module is stateless — all state lives in the caller (candle cache,
DB). Call evaluate_symbol() with candle lists each time.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.logic.indicators import (
    last_atr,
    last_bollinger,
    last_ema,
    last_macd,
    last_rsi,
)
from backend.logic.strategies import (
    combine_strategies,
    momentum,
    mean_reversion,
    trend_follow,
)

# Minimum candle counts needed for each indicator
_MIN_CANDLES_TREND  = 210   # needs EMA200
_MIN_CANDLES_MR     = 30    # needs BB20 + RSI14
_MIN_CANDLES_MACD   = 45    # needs MACD(12,26,9) + 9-bar signal


@dataclass
class SignalRecord:
    id:           str
    symbol:       str
    timeframe:    str
    side:         str            # "BUY" | "SELL" | "FLAT"
    entry_price:  float
    stop_loss:    Optional[float]
    take_profit:  Optional[float]
    confidence:   float          # 0.0 – 1.0
    strategy_id:  str            # "combined" or individual id
    created_at:   int            # unix seconds
    valid_until:  int            # unix seconds (created_at + TTL)
    metadata:     Dict[str, Any] = field(default_factory=dict)


def _sl_tp(
    side: str,
    entry: float,
    atr_val: Optional[float],
    atr_mult_sl: float = 1.5,
    rr_ratio: float = 2.0,
) -> tuple[Optional[float], Optional[float]]:
    """Compute SL and TP from ATR. Returns (stop_loss, take_profit)."""
    if atr_val is None or atr_val <= 0:
        return None, None

    risk = atr_val * atr_mult_sl
    if side == "BUY":
        sl = entry - risk
        tp = entry + risk * rr_ratio
    elif side == "SELL":
        sl = entry + risk
        tp = entry - risk * rr_ratio
    else:
        return None, None

    return round(sl, 8), round(tp, 8)


def evaluate_symbol(
    symbol: str,
    timeframe: str,
    closes: List[float],
    highs: List[float],
    lows: List[float],
    current_price: float,
    signal_ttl_seconds: int = 900,   # 15 min default
) -> SignalRecord:
    """
    Run all strategies against candle data and return a SignalRecord.

    Args:
        symbol:        e.g. "BTCUSDT"
        timeframe:     e.g. "1h"
        closes:        list of close prices, oldest first
        highs / lows:  list of highs/lows, same length as closes
        current_price: latest ticker price (for entry_price)
        signal_ttl_seconds: how long the signal is valid

    Returns a SignalRecord. Never raises — returns FLAT on errors.
    """
    now = int(time.time())
    sig_id = str(uuid.uuid4())

    try:
        n = len(closes)

        # --- ATR (always computed if enough bars) ---
        atr_val = last_atr(highs, lows, closes, 14) if n >= 16 else None

        # --- Indicators for each strategy ---

        # Trend-follow: EMA 20/50/200
        ema20  = last_ema(closes, 20)  if n >= 20  else None
        ema50  = last_ema(closes, 50)  if n >= 50  else None
        ema200 = last_ema(closes, 200) if n >= 200 else None
        rsi14  = last_rsi(closes, 14)  if n >= 16  else None

        # Mean-reversion: BB(20) + RSI(14)
        bb_upper, bb_mid, bb_lower = last_bollinger(closes, 20, 2.0) if n >= 20 else (None, None, None)

        # Momentum: MACD(12,26,9) — need current and prev bar for crossover detection
        if n >= 36:
            # Efficiently get both current and previous MACD values in one pass
            macd_vals = last_macd(closes, 12, 26, 9, count=2)
            prev_macd_l, prev_sig_l, _ = macd_vals[0]
            macd_l, sig_l, hist = macd_vals[1]
        elif n >= 35:
            # Returns a single Tuple (ml, sl, hist) by default
            macd_l, sig_l, hist = last_macd(closes, 12, 26, 9)
            prev_macd_l = prev_sig_l = None
        else:
            macd_l = sig_l = hist = prev_macd_l = prev_sig_l = None

        # --- Run strategies ---
        results = []

        if n >= _MIN_CANDLES_TREND:
            results.append(trend_follow(ema20, ema50, ema200, rsi14))
        if n >= _MIN_CANDLES_MR:
            results.append(mean_reversion(rsi14, current_price,
                                          bb_upper, bb_lower, bb_mid))
        if n >= _MIN_CANDLES_MACD:
            results.append(momentum(macd_l, sig_l, hist, prev_macd_l, prev_sig_l))

        if not results:
            # Not enough candle history
            return SignalRecord(
                id=sig_id, symbol=symbol, timeframe=timeframe,
                side="FLAT", entry_price=current_price,
                stop_loss=None, take_profit=None,
                confidence=0.0, strategy_id="insufficient_data",
                created_at=now, valid_until=now + signal_ttl_seconds,
                metadata={"reason": f"need more candles (have {n})"},
            )

        combined = combine_strategies(results)
        side       = combined["side"]
        confidence = combined["confidence"]

        sl, tp = _sl_tp(side, current_price, atr_val)

        return SignalRecord(
            id=sig_id,
            symbol=symbol,
            timeframe=timeframe,
            side=side,
            entry_price=round(current_price, 8),
            stop_loss=sl,
            take_profit=tp,
            confidence=confidence,
            strategy_id="combined",
            created_at=now,
            valid_until=now + signal_ttl_seconds,
            metadata={
                "indicators": {
                    "ema20":      round(ema20, 4)  if ema20  else None,
                    "ema50":      round(ema50, 4)  if ema50  else None,
                    "ema200":     round(ema200, 4) if ema200 else None,
                    "rsi14":      round(rsi14, 2)  if rsi14  else None,
                    "bb_upper":   round(bb_upper, 4) if bb_upper else None,
                    "bb_mid":     round(bb_mid, 4)   if bb_mid   else None,
                    "bb_lower":   round(bb_lower, 4) if bb_lower else None,
                    "macd":       round(macd_l, 6)   if macd_l   else None,
                    "macd_signal":round(sig_l, 6)    if sig_l    else None,
                    "macd_hist":  round(hist, 6)     if hist     else None,
                    "atr14":      round(atr_val, 4)  if atr_val  else None,
                },
                "strategy_votes": combined["strategy_votes"],
                "reasons":        combined["reasons"],
                "tags":           combined["tags"],
                "candles_used":   n,
            },
        )

    except Exception as exc:  # pragma: no cover
        return SignalRecord(
            id=sig_id, symbol=symbol, timeframe=timeframe,
            side="FLAT", entry_price=current_price,
            stop_loss=None, take_profit=None,
            confidence=0.0, strategy_id="error",
            created_at=now, valid_until=now + signal_ttl_seconds,
            metadata={"error": str(exc)},
        )
