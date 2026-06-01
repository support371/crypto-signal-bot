# backend/logic/indicators.py
"""
Technical indicator library — pure functions, no side effects.

All functions operate on plain Python lists of floats (close prices,
high, low, volume) so they can be used in tests without any framework.

Functions return None (or list with None padding) when there is
insufficient data rather than raising.
"""
from __future__ import annotations

from typing import List, Optional, Tuple


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------

def ema(values: List[float], period: int) -> List[Optional[float]]:
    """
    Exponential Moving Average.
    Returns a list of the same length — leading values are None until
    `period` bars of data are available.
    """
    if not values or period <= 0:
        return [None] * len(values)

    result: List[Optional[float]] = [None] * len(values)
    k = 2.0 / (period + 1)
    seed_idx = period - 1

    if len(values) < period:
        return result

    # Seed with SMA
    seed = sum(values[:period]) / period
    result[seed_idx] = seed

    prev = seed
    for i in range(seed_idx + 1, len(values)):
        val = values[i] * k + prev * (1 - k)
        result[i] = val
        prev = val

    return result


def last_ema(values: List[float], period: int) -> Optional[float]:
    """Return the most recent EMA value, or None if insufficient data."""
    r = ema(values, period)
    for v in reversed(r):
        if v is not None:
            return v
    return None


# ---------------------------------------------------------------------------
# RSI
# ---------------------------------------------------------------------------

def rsi(values: List[float], period: int = 14) -> List[Optional[float]]:
    """
    Relative Strength Index (Wilder smoothing).
    Returns list of same length; leading values are None.
    """
    if len(values) < period + 1:
        return [None] * len(values)

    result: List[Optional[float]] = [None] * len(values)
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]

    gains = [max(c, 0.0) for c in changes]
    losses = [abs(min(c, 0.0)) for c in changes]

    # Seed averages using simple mean of first `period` bars
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    seed_idx = period  # index into `values` (offset by 1 for changes)

    if avg_loss == 0:
        result[seed_idx] = 100.0
    else:
        rs = avg_gain / avg_loss
        result[seed_idx] = 100.0 - (100.0 / (1 + rs))

    for i in range(period + 1, len(values)):
        ci = i - 1  # index into changes
        avg_gain = (avg_gain * (period - 1) + gains[ci]) / period
        avg_loss = (avg_loss * (period - 1) + losses[ci]) / period
        if avg_loss == 0:
            result[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[i] = 100.0 - (100.0 / (1 + rs))

    return result


def last_rsi(values: List[float], period: int = 14) -> Optional[float]:
    r = rsi(values, period)
    for v in reversed(r):
        if v is not None:
            return v
    return None


# ---------------------------------------------------------------------------
# MACD
# ---------------------------------------------------------------------------

def macd(
    values: List[float],
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """
    MACD line, signal line, histogram.
    Returns three lists of same length as `values`.
    """
    ema_fast = ema(values, fast)
    ema_slow = ema(values, slow)

    macd_line: List[Optional[float]] = []
    for f, s in zip(ema_fast, ema_slow):
        if f is None or s is None:
            macd_line.append(None)
        else:
            macd_line.append(f - s)

    # Signal = EMA of MACD line (using only non-None values)
    # Build a dense list for EMA calculation
    non_none_indices = [i for i, v in enumerate(macd_line) if v is not None]
    if not non_none_indices:
        nones = [None] * len(values)
        return macd_line, nones, nones

    dense_macd = [macd_line[i] for i in non_none_indices]  # type: ignore[misc]
    dense_signal = ema(dense_macd, signal_period)  # type: ignore[arg-type]

    # Map back to full-length list
    signal_line: List[Optional[float]] = [None] * len(values)
    histogram: List[Optional[float]] = [None] * len(values)

    for offset, orig_idx in enumerate(non_none_indices):
        sig = dense_signal[offset]
        ml = macd_line[orig_idx]
        signal_line[orig_idx] = sig
        if sig is not None and ml is not None:
            histogram[orig_idx] = ml - sig

    return macd_line, signal_line, histogram


def last_macd(
    values: List[float],
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Return (macd_line, signal_line, histogram) for the most recent bar."""
    ml, sl, hist = macd(values, fast, slow, signal_period)

    def _last(lst: List[Optional[float]]) -> Optional[float]:
        for v in reversed(lst):
            if v is not None:
                return v
        return None

    return _last(ml), _last(sl), _last(hist)


# ---------------------------------------------------------------------------
# Bollinger Bands
# ---------------------------------------------------------------------------

def bollinger_bands(
    values: List[float],
    period: int = 20,
    num_std: float = 2.0,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """
    Returns (upper, middle, lower) bands. Middle is SMA. Leading values None.
    Optimized to O(n) using rolling sum and rolling sum of squares.
    """
    n = len(values)
    upper: List[Optional[float]] = [None] * n
    middle: List[Optional[float]] = [None] * n
    lower: List[Optional[float]] = [None] * n

    if n < period or period <= 0:
        return upper, middle, lower

    # Use rolling sums to achieve O(n) complexity instead of O(n * period)
    current_sum = 0.0
    current_sq_sum = 0.0

    for i in range(n):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val

        if i >= period:
            # Remove the value that just left the window
            old_val = values[i - period]
            current_sum -= old_val
            current_sq_sum -= old_val * old_val

        if i >= period - 1:
            # Calculate SMA and Variance
            # Variance = E[X^2] - (E[X])^2
            sma = current_sum / period
            variance = (current_sq_sum / period) - (sma * sma)
            # Safeguard against tiny negative numbers due to floating point precision
            std = max(variance, 0.0) ** 0.5

            middle[i] = sma
            upper[i] = sma + num_std * std
            lower[i] = sma - num_std * std

    return upper, middle, lower


def last_bollinger(
    values: List[float],
    period: int = 20,
    num_std: float = 2.0,
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Return (upper, middle, lower) for the most recent bar."""
    upper, middle, lower = bollinger_bands(values, period, num_std)
    def _last(lst):
        for v in reversed(lst):
            if v is not None:
                return v
        return None
    return _last(upper), _last(middle), _last(lower)


# ---------------------------------------------------------------------------
# ATR
# ---------------------------------------------------------------------------

def atr(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    period: int = 14,
) -> List[Optional[float]]:
    """
    Average True Range (Wilder smoothing).
    Returns list same length as inputs.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        raise ValueError("highs, lows, closes must be same length")
    if n < 2:
        return [None] * n

    tr_list: List[float] = []
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr_list.append(max(hl, hpc, lpc))

    result: List[Optional[float]] = [None] * n
    if len(tr_list) < period:
        return result

    # Seed with simple average of first `period` TRs
    seed = sum(tr_list[:period]) / period
    result[period] = seed  # index in closes (offset by 1)

    prev = seed
    for i in range(period + 1, n):
        ti = i - 1  # index in tr_list
        val = (prev * (period - 1) + tr_list[ti]) / period
        result[i] = val
        prev = val

    return result


def last_atr(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    period: int = 14,
) -> Optional[float]:
    r = atr(highs, lows, closes, period)
    for v in reversed(r):
        if v is not None:
            return v
    return None
