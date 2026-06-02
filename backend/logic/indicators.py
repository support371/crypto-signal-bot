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
    """
    Return the most recent EMA value.
    Optimized: O(n) time, O(1) space (no list allocations).
    """
    if not values or period <= 0 or len(values) < period:
        return None

    k = 2.0 / (period + 1)
    # Seed with SMA of the first `period` elements
    current_ema = sum(values[:period]) / period

    # Iteratively update
    for i in range(period, len(values)):
        current_ema = values[i] * k + current_ema * (1 - k)

    return current_ema


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
    Optimized: O(n) time, O(1) space (no list allocations).
    """
    if len(values) < period + 1:
        return None

    # Calculate initial averages
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        if diff > 0:
            gains += diff
        else:
            losses -= diff

    avg_gain = gains / period
    avg_loss = losses / period

    # Wilder smoothing
    for i in range(period + 1, len(values)):
        diff = values[i] - values[i - 1]
        g = max(diff, 0.0)
        l = max(-diff, 0.0)
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period

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
) -> List[Tuple[Optional[float], Optional[float], Optional[float]]]:
    """
    Return the last `count` MACD values (macd_line, signal_line, histogram).
    Optimized: Returns a list of tuples, where the last element is the most recent.
    Example: last_macd(..., count=2) -> [(prev_ml, prev_sl, prev_hist), (curr_ml, curr_sl, curr_hist)]
    """
    if len(values) < slow + signal_period - 1:
        return [(None, None, None)] * count

    # MACD line = EMA(fast) - EMA(slow)

    # Efficiently get enough EMA values to compute the needed MACD lines
    # EMA(slow) needs more data than EMA(fast)
    # We need a dense series of MACD lines to compute the Signal EMA

    ema_f = ema(values, fast)
    ema_s = ema(values, slow)

    macd_line: List[float] = []
    for f, s in zip(ema_f, ema_s):
        if f is not None and s is not None:
            macd_line.append(f - s)

    if len(macd_line) < signal_period:
        return [(None, None, None)] * count

    # Now compute the Signal Line (EMA of MACD line)
    # We only need the last `count` values of the Signal EMA
    sig_line_full = ema(macd_line, signal_period)

    results = []
    # Map back the requested number of results
    # The last `count` values of sig_line_full correspond to the last `count` bars
    requested_sig = sig_line_full[-count:]
    requested_macd = macd_line[-count:]

    for ml, sl in zip(requested_macd, requested_sig):
        if ml is not None and sl is not None:
            results.append((ml, sl, ml - sl))
        else:
            results.append((None, None, None))

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
    Optimized: O(period) time, O(period) space. Much faster than O(n) when n >> period.
    """
    if len(values) < period or period <= 0:
        return None, None, None

    # We only need the most recent window
    window = values[-period:]
    sma = sum(window) / period
    # Variance = E[X^2] - (E[X])^2 is faster but can be unstable for small windows;
    # for period=20, standard sum((x-mean)^2) is fine and robust.
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
    Optimized: O(n) time, O(1) space.
    """
    n = len(closes)
    if n < period + 1:
        return None

    # Initial TR average (SMA)
    tr_sum = 0.0
    for i in range(1, period + 1):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr_sum += max(hl, hpc, lpc)

    prev_atr = tr_sum / period

    # Wilder smoothing
    for i in range(period + 1, n):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr = max(hl, hpc, lpc)
        prev_atr = (prev_atr * (period - 1) + tr) / period

    return prev_atr
