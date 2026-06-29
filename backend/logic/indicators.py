# backend/logic/indicators.py
"""
Technical indicator library — pure functions, no side effects.

All functions operate on plain Python lists of floats (close prices,
high, low, volume) so they can be used in tests without any framework.

Functions return None (or list with None padding) when there is
insufficient data rather than raising.
"""
from __future__ import annotations

import math
from itertools import islice
from typing import Any, List, Optional, Tuple


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------

def ema(values: List[float], period: int) -> List[Optional[float]]:
    """
    Exponential Moving Average.
    Returns a list of the same length — leading values are None until
    `period` bars of data are available.
    Optimized with itertools.islice to eliminate O(1) manual indexing overhead.
    """
    if not values or period <= 0:
        return [None] * len(values)

    n = len(values)
    if n < period:
        return [None] * n

    result: List[Optional[float]] = [None] * (period - 1)
    k = 2.0 / (period + 1)

    # Seed with SMA
    val = sum(islice(values, 0, period)) / period
    result.append(val)

    # Simplified update rule: val += k * (input - val)
    for curr in islice(values, period, None):
        val += k * (curr - val)
        result.append(val)

    return result


def last_ema(values: List[float], period: int) -> Optional[float]:
    """
    Return the most recent EMA value, or None if insufficient data.
    Optimized to O(n) time and O(1) space by avoiding full list allocation.
    Further optimized with itertools.islice to avoid indexing overhead.
    """
    if len(values) < period or period <= 0:
        return None

    k = 2.0 / (period + 1)
    # Seed with SMA of first 'period' values
    val = sum(islice(values, 0, period)) / period

    # Progressively calculate EMA for the rest
    # Using simplified update rule: val += k * (input - val)
    for curr in islice(values, period, None):
        val += k * (curr - val)

    return val


# ---------------------------------------------------------------------------
# RSI
# ---------------------------------------------------------------------------

def rsi(values: List[float], period: int = 14) -> List[Optional[float]]:
    """
    Relative Strength Index (Wilder smoothing).
    Returns list of same length; leading values are None.
    Optimized to O(n) without intermediate list allocations.
    Uses itertools.islice and zip to eliminate manual indexing overhead.
    Algebraically simplified update rule for Wilder smoothing:
    val += (input - val) / period
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n

    result: List[Optional[float]] = [None] * period

    inv_period = 1.0 / period
    avg_gain = 0.0
    avg_loss = 0.0

    # Initial seed: SMA of first 'period' gains/losses
    it = iter(values)
    prev = next(it)
    for curr in islice(it, 0, period):
        change = curr - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = curr

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Use combined formula for RSI to reduce divisions: 100 * gain / (gain + loss)
    total = avg_gain + avg_loss
    result.append(50.0 if total == 0 else 100.0 * avg_gain / total)

    # Wilder smoothing for the rest
    minus_one_over_period = (period - 1) * inv_period
    for curr in islice(values, period + 1, None):
        change = curr - prev

        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period

        total = avg_gain + avg_loss
        result.append(50.0 if total == 0 else 100.0 * avg_gain / total)
        prev = curr

    return result


def last_rsi(values: List[float], period: int = 14) -> Optional[float]:
    """
    Return the most recent RSI value.
    Optimized to O(n) time and O(1) space.
    Uses itertools.islice and iter to eliminate indexing overhead in hot loops.
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return None

    inv_period = 1.0 / period
    minus_one_over_period = (period - 1) * inv_period

    # Initial averages
    avg_gain = 0.0
    avg_loss = 0.0

    it = iter(values)
    prev = next(it)
    for curr in islice(it, 0, period):
        change = curr - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = curr

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Wilder smoothing for the rest
    for curr in islice(values, period + 1, None):
        change = curr - prev
        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period
        prev = curr

    total = avg_gain + avg_loss
    if total == 0:
        return 50.0

    # Optimized RSI formula: 100 * gain / (gain + loss)
    return 100.0 * avg_gain / total


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
    Optimized to O(N) using a single-pass iterative implementation to avoid
    multiple EMA passes and intermediate list allocations.
    """
    n = len(values)
    macd_line: List[Optional[float]] = [None] * n
    signal_line: List[Optional[float]] = [None] * n
    histogram: List[Optional[float]] = [None] * n

    p_max = max(fast, slow)
    if n < p_max or fast <= 0 or slow <= 0 or signal_period <= 0:
        return macd_line, signal_line, histogram

    k_fast = 2.0 / (fast + 1)
    k_slow = 2.0 / (slow + 1)
    k_sig = 2.0 / (signal_period + 1)

    # 1. Seed fast and slow EMAs
    ema_f = sum(values[:fast]) / fast
    for i in range(fast, p_max):
        ema_f += k_fast * (values[i] - ema_f)

    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max):
        ema_s += k_slow * (values[i] - ema_s)

    # First MACD value at index p_max - 1
    m_val = ema_f - ema_s
    macd_line[p_max - 1] = m_val

    # 2. Progress until we can seed the signal line
    # Signal starts after 'signal_period' MACD values.
    # The first signal value is the SMA of the first 'signal_period' MACD values.
    macd_sum = m_val
    signal_start_idx = p_max + signal_period - 2
    curr = p_max

    while curr < n and curr < signal_start_idx:
        v = values[curr]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        m_val = ema_f - ema_s
        macd_line[curr] = m_val
        macd_sum += m_val
        curr += 1

    if curr == signal_start_idx and curr < n:
        # Seed signal SMA at signal_start_idx
        v = values[curr]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        m_val = ema_f - ema_s
        macd_line[curr] = m_val
        macd_sum += m_val

        sig_ema = macd_sum / signal_period
        signal_line[curr] = sig_ema
        histogram[curr] = m_val - sig_ema
        curr += 1

        # 3. Process remaining bars
        for i in range(curr, n):
            v = values[i]
            ema_f += k_fast * (v - ema_f)
            ema_s += k_slow * (v - ema_s)
            m_val = ema_f - ema_s
            sig_ema += k_sig * (m_val - sig_ema)

            macd_line[i] = m_val
            signal_line[i] = sig_ema
            histogram[i] = m_val - sig_ema

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
    Optimized to O(n) time and O(count) space by avoiding full series allocation.
    If count=1 (default), returns a single tuple (ml, sl, hist) for backward compatibility.
    If count > 1, returns a list of tuples, newest last.
    """
    n = len(values)
    p_max = max(fast, slow)

    # We need enough data for the slow EMA seed AND the signal EMA seed
    if n < p_max + signal_period - 1 or fast <= 0 or slow <= 0 or signal_period <= 0:
        if count == 1:
            return None, None, None
        return [(None, None, None)] * count

    k_fast = 2.0 / (fast + 1)
    k_slow = 2.0 / (slow + 1)
    k_sig = 2.0 / (signal_period + 1)

    # 1. Seed fast and slow EMAs
    # Seed short period EMA first, then progress it to p_max-1
    ema_f = sum(values[:fast]) / fast
    for i in range(fast, p_max):
        ema_f += k_fast * (values[i] - ema_f)

    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max):
        ema_s += k_slow * (values[i] - ema_s)

    # Both EMAs are now at index p_max - 1. Calculate first MACD value.
    macd_val = ema_f - ema_s

    # 2. Seed Signal EMA
    # We need 'signal_period' MACD values to calculate the first signal SMA.
    macd_history = [macd_val]
    curr = p_max
    while len(macd_history) < signal_period:
        v = values[curr]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        macd_history.append(macd_val)
        curr += 1

    # First signal EMA value is the SMA of the first 'signal_period' MACD values.
    # This corresponds to original index (p_max - 1) + (signal_period - 1).
    sig_ema = sum(macd_history) / signal_period

    results = []
    # If the current index is within the 'count' range, capture the result.
    if curr >= n - count + 1:
        results.append((macd_history[-1], sig_ema, macd_history[-1] - sig_ema))

    # 3. Process remaining bars iteratively
    for i in range(curr, n):
        v = values[i]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        sig_ema += k_sig * (macd_val - sig_ema)

        if i >= n - count:
            results.append((macd_val, sig_ema, macd_val - sig_ema))

    if count == 1:
        return results[-1] if results else (None, None, None)

    # Ensure we return exactly 'count' items, padded with None if necessary.
    if len(results) < count:
        results = [(None, None, None)] * (count - len(results)) + results
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
    Further optimized by unrolling the initialization loop to eliminate
    conditional branches inside the main loop and using multiplicative inverse.
    """
    n = len(values)
    upper: List[Optional[float]] = [None] * n
    middle: List[Optional[float]] = [None] * n
    lower: List[Optional[float]] = [None] * n

    if n < period or period <= 0:
        return upper, middle, lower

    inv_period = 1.0 / period
    current_sum = 0.0
    current_sq_sum = 0.0

    # 1. Prime the sums for the first window (excluding the last element)
    for i in range(period - 1):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val

    # 2. Main loop: process elements from 'period - 1' to 'n - 1'
    for i in range(period - 1, n):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val

        # Calculate SMA and Variance: Variance = E[X^2] - (E[X])^2
        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        # Safeguard against tiny negative numbers due to floating point precision
        std = math.sqrt(max(variance, 0.0))

        middle[i] = sma
        offset = num_std * std
        upper[i] = sma + offset
        lower[i] = sma - offset

        # Remove the value that will leave the window in the next iteration
        old_val = values[i - period + 1]
        current_sum -= old_val
        current_sq_sum -= old_val * old_val

    return upper, middle, lower


def last_bollinger(
    values: List[float],
    period: int = 20,
    num_std: float = 2.0,
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    Return (upper, middle, lower) for the most recent bar.
    Optimized to O(period) time and O(1) space for the last-value calculation.
    Further optimized by replacing generator overhead with explicit loop and
    using multiplicative inverse for division.
    """
    n = len(values)
    if n < period or period <= 0:
        return None, None, None

    # We only need the last 'period' values
    window = values[-period:]
    inv_period = 1.0 / period
    sma = sum(window) * inv_period

    # Explicit loop is faster than generator expression in sum()
    sq_diff_sum = 0.0
    for x in window:
        diff = x - sma
        sq_diff_sum += diff * diff

    variance = sq_diff_sum * inv_period
    std = math.sqrt(max(variance, 0.0))

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
    Optimized with zip and itertools.islice to eliminate manual indexing.
    Algebraically simplified update rule for Wilder smoothing:
    val += (tr - val) / period
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        raise ValueError("highs, lows, closes must be same length")
    if n < period + 1 or period <= 0:
        return [None] * n

    result: List[Optional[float]] = [None] * period
    inv_period = 1.0 / period

    # Seed with simple average of first `period` TRs
    tr_sum = 0.0
    # zip is lazy and avoids index lookups
    it = zip(islice(highs, 1, period + 1),
             islice(lows, 1, period + 1),
             islice(closes, 0, period))
    for h, l, pc in it:
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)
        # tr = max(hl, hpc, lpc) - using conditional logic to avoid max() overhead
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period
    result.append(val)

    # Wilder smoothing for the rest
    it = zip(islice(highs, period + 1, None),
             islice(lows, period + 1, None),
             islice(closes, period, None))
    for h, l, pc in it:
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)

        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc

        val += (tr - val) * inv_period
        result.append(val)

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
    Uses zip and itertools.islice to streamline the Wilder smoothing loop.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        return None
    if n < period + 1 or period <= 0:
        return None

    inv_period = 1.0 / period
    tr_sum = 0.0

    # Seed with average of first 'period' TRs
    it = zip(islice(highs, 1, period + 1),
             islice(lows, 1, period + 1),
             islice(closes, 0, period))
    for h, l, pc in it:
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period

    # Wilder smoothing for the rest
    it = zip(islice(highs, period + 1, None),
             islice(lows, period + 1, None),
             islice(closes, period, None))
    for h, l, pc in it:
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        val += (tr - val) * inv_period

    return val
