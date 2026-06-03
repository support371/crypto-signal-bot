# backend/logic/indicators.py
"""
Technical indicator library — pure functions, no side effects.

All functions operate on plain Python lists of floats (close prices,
high, low, volume) so they can be used in tests without any framework.

Functions return None (or list with None padding) when there is
insufficient data rather than raising.
"""
from __future__ import annotations

from typing import Any, List, Optional, Tuple


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
    """
    Return the most recent EMA value, or None if insufficient data.
    Optimized to O(n) time and O(1) space by avoiding full list allocation.
    """
    if len(values) < period or period <= 0:
        return None

    k = 2.0 / (period + 1)
    # Seed with SMA of first 'period' values
    val = sum(values[:period]) / period

    # Progressively calculate EMA for the rest
    for i in range(period, len(values)):
        val = values[i] * k + val * (1 - k)

    return val


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
    """
    Return the most recent RSI value.
    Optimized to O(n) time and O(1) space by avoiding list allocations for changes, gains, and losses.
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return None

    # Initial averages
    avg_gain = 0.0
    avg_loss = 0.0

    for i in range(1, period + 1):
        change = values[i] - values[i - 1]
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change

    avg_gain /= period
    avg_loss /= period

    # Wilder smoothing for the rest
    for i in range(period + 1, n):
        change = values[i] - values[i - 1]
        gain = change if change > 0 else 0.0
        loss = -change if change < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period

    if avg_loss == 0:
        return 100.0

    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1 + rs))


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
    count: int = 1,
) -> Any:
    """
    Return (macd_line, signal_line, histogram) for the most recent 'count' bars.
    If count=1 (default), returns a single tuple (ml, sl, hist) for backward compatibility.
    If count > 1, returns a list of tuples, newest last.
    """
    ml, sl, hist = macd(values, fast, slow, signal_period)

    results = []
    for i in range(len(ml) - count, len(ml)):
        if i < 0:
            results.append((None, None, None))
        else:
            results.append((ml[i], sl[i], hist[i]))

    if count == 1:
        return results[0]
    return results


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
    """
    Return (upper, middle, lower) for the most recent bar.
    Optimized to O(period) time and O(1) space for the last-value calculation.
    """
    n = len(values)
    if n < period or period <= 0:
        return None, None, None

    # We only need the last 'period' values
    window = values[-period:]
    sma = sum(window) / period
    variance = sum((x - sma) ** 2 for x in window) / period
    std = max(variance, 0.0) ** 0.5

    return sma + num_std * std, sma, sma - num_std * std


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
    """
    Return the most recent ATR value.
    Optimized to O(n) time and O(1) space.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        return None
    if n < period + 1 or period <= 0:
        return None

    # Calculate first True Range (tr0) to start seeding
    # tr_list start at i=1
    def get_tr(i):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        return max(hl, hpc, lpc)

    # Seed with average of first 'period' TRs
    # Seed value is for result[period]
    tr_sum = 0.0
    for i in range(1, period + 1):
        tr_sum += get_tr(i)

    val = tr_sum / period

    # Wilder smoothing for the rest
    for i in range(period + 1, n):
        val = (val * (period - 1) + get_tr(i)) / period

    return val
