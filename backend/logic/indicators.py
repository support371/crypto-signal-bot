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
    """
    n = len(values)
    if not values or period <= 0:
        return [None] * n

    result: List[Optional[float]] = [None] * n
    if n < period:
        return result

    k = 2.0 / (period + 1)
    it = iter(values)

    # Seed with SMA
    seed = sum(islice(it, period)) / period
    seed_idx = period - 1
    result[seed_idx] = seed

    prev = seed
    for i in range(period, n):
        # Simplified update rule: val += k * (input - val)
        prev += k * (values[i] - prev)
        result[i] = prev

    return result


def last_ema(values: List[float], period: int) -> Optional[float]:
    """
    Return the most recent EMA value, or None if insufficient data.
    Optimized to O(n) time and O(1) space by avoiding full list allocation.
    Further optimized using iterator-based loops to eliminate indexing overhead.
    """
    if len(values) < period or period <= 0:
        return None

    k = 2.0 / (period + 1)
    it = iter(values)
    # Seed with SMA of first 'period' values
    val = sum(islice(it, period)) / period

    # Progressively calculate EMA for the rest
    # Using simplified update rule: val += k * (input - val)
    for x in it:
        val += k * (x - val)

    return val


# ---------------------------------------------------------------------------
# RSI
# ---------------------------------------------------------------------------

def rsi(values: List[float], period: int = 14) -> List[Optional[float]]:
    """
    Relative Strength Index (Wilder smoothing).
    Returns list of same length; leading values are None.
    Optimized to O(n) without intermediate list allocations.
    Algebraically simplified update rule for Wilder smoothing:
    val += (input - val) / period
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n

    result: List[Optional[float]] = [None] * n
    inv_period = 1.0 / period
    avg_gain = 0.0
    avg_loss = 0.0

    it = iter(values)
    prev = next(it)

    # Initial seed: SMA of first 'period' gains/losses
    for x in islice(it, period):
        change = x - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = x

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Use combined formula for RSI to reduce divisions: 100 * gain / (gain + loss)
    total = avg_gain + avg_loss
    if total == 0:
        result[period] = 50.0
    else:
        result[period] = 100.0 * avg_gain / total

    # Wilder smoothing for the rest
    prev_weight = (period - 1) * inv_period
    for i in range(period + 1, n):
        curr = values[i]
        change = curr - prev

        avg_gain *= prev_weight
        avg_loss *= prev_weight
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period

        total = avg_gain + avg_loss
        if total == 0:
            result[i] = 50.0
        else:
            result[i] = 100.0 * avg_gain / total
        prev = curr

    return result


def last_rsi(values: List[float], period: int = 14) -> Optional[float]:
    """
    Return the most recent RSI value.
    Optimized to O(n) time and O(1) space by avoiding list allocations for changes, gains, and losses.
    Further optimized by using iterator-based loops to eliminate indexing overhead.
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return None

    inv_period = 1.0 / period
    prev_weight = (period - 1) * inv_period

    # Initial averages
    avg_gain = 0.0
    avg_loss = 0.0

    it = iter(values)
    prev = next(it)

    for x in islice(it, period):
        change = x - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = x

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Wilder smoothing for the rest
    for x in it:
        change = x - prev
        avg_gain *= prev_weight
        avg_loss *= prev_weight
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period
        prev = x

    total = avg_gain + avg_loss
    if total == 0:
        return 50.0

    # Optimized RSI formula: 100 * gain / (gain + loss)
    # Reduces two divisions to one and is mathematically equivalent.
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
    Further optimized using iterator-based loops to eliminate indexing overhead.
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
    # Fast EMA seed
    ema_f = sum(values[:fast]) / fast
    for i in range(fast, p_max):
        ema_f += k_fast * (values[i] - ema_f)

    # Slow EMA seed
    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max):
        ema_s += k_slow * (values[i] - ema_s)

    # First MACD value at index p_max - 1
    m_val = ema_f - ema_s
    macd_line[p_max - 1] = m_val

    # 2. Progress until we can seed the signal line
    macd_sum = m_val
    signal_start_idx = p_max + signal_period - 2

    it = islice(enumerate(values), p_max, None)
    curr = p_max - 1

    for i, v in it:
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        m_val = ema_f - ema_s
        macd_line[i] = m_val
        macd_sum += m_val
        curr = i
        if i >= signal_start_idx:
            break

    if curr == signal_start_idx:
        # Seed signal SMA
        sig_ema = macd_sum / signal_period
        signal_line[curr] = sig_ema
        histogram[curr] = m_val - sig_ema

        # 3. Process remaining bars
        for i, v in it:
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
    Further optimized using iterator-based loops to eliminate indexing overhead.
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
    # Fast EMA seed
    ema_f = sum(values[:fast]) / fast
    for i in range(fast, p_max):
        ema_f += k_fast * (values[i] - ema_f)

    # Slow EMA seed
    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max):
        ema_s += k_slow * (values[i] - ema_s)

    # First MACD value at index p_max - 1
    macd_val = ema_f - ema_s

    # 2. Seed Signal EMA
    # We need 'signal_period' MACD values to calculate the first signal SMA.
    macd_history = [macd_val]
    it = iter(islice(values, p_max, None))

    # curr_idx tracks the index of the most recently processed value from 'values'
    curr_idx = p_max - 1

    for v in it:
        curr_idx += 1
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        macd_history.append(macd_val)
        if len(macd_history) == signal_period:
            break

    # First signal EMA value is the SMA of the first 'signal_period' MACD values.
    sig_ema = sum(macd_history) / signal_period

    results = []
    if curr_idx >= n - count:
        results.append((macd_val, sig_ema, macd_val - sig_ema))

    # 3. Process remaining bars iteratively
    for v in it:
        curr_idx += 1
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        sig_ema += k_sig * (macd_val - sig_ema)

        if curr_idx >= n - count:
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
    Further optimized by using zip and islice to avoid indexing overhead.
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
    for val in islice(values, period - 1):
        current_sum += val
        current_sq_sum += val * val

    # 2. Main loop: process elements from 'period - 1' to 'n - 1'
    # Use zip with islice to efficiently traverse and maintain window
    for i, (new_val, old_val) in enumerate(zip(islice(values, period - 1, None), values), start=period - 1):
        current_sum += new_val
        current_sq_sum += new_val * new_val

        # Calculate SMA and Variance: Variance = E[X^2] - (E[X])^2
        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        # Safeguard against tiny negative numbers due to floating point precision
        std = math.sqrt(variance if variance > 0 else 0.0)

        middle[i] = sma
        offset = num_std * std
        upper[i] = sma + offset
        lower[i] = sma - offset

        # Remove the value that will leave the window in the next iteration
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
    using conditional expression for math.sqrt safeguard.
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
    std = math.sqrt(variance if variance > 0 else 0.0)

    offset = num_std * std
    return sma + offset, sma, sma - offset


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
    Optimized to O(n) without intermediate list allocations.
    Further optimized using zip and islice to avoid indexing overhead.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        raise ValueError("highs, lows, closes must be same length")
    if n < period + 1 or period <= 0:
        return [None] * n

    result: List[Optional[float]] = [None] * n
    inv_period = 1.0 / period

    # Seed with simple average of first `period` TRs
    tr_sum = 0.0
    it_h = islice(highs, 1, None)
    it_l = islice(lows, 1, None)
    it_pc = iter(closes)

    for h, l_val, pc in islice(zip(it_h, it_l, it_pc), period):
        hl = h - l_val
        hpc = abs(h - pc)
        lpc = abs(l_val - pc)
        # Manually find max for performance
        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period
    result[period] = val

    # Wilder smoothing for the rest
    for i in range(period + 1, n):
        h = highs[i]
        l_val = lows[i]
        pc = closes[i - 1]

        hl = h - l_val
        hpc = abs(h - pc)
        lpc = abs(l_val - pc)

        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc

        # val = (val * (period - 1) + tr) / period
        # Simplified: val += (tr - val) / period
        val += (tr - val) * inv_period
        result[i] = val

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
    Further optimized by using zip and islice to avoid indexing overhead.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        return None
    if n < period + 1 or period <= 0:
        return None

    inv_period = 1.0 / period
    tr_sum = 0.0

    it_h = islice(highs, 1, None)
    it_l = islice(lows, 1, None)
    it_pc = iter(closes)

    # Seed with average of first 'period' TRs
    for h, l_val, pc in islice(zip(it_h, it_l, it_pc), period):
        hl = h - l_val
        hpc = abs(h - pc)
        lpc = abs(l_val - pc)

        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period

    # Wilder smoothing for the rest
    for h, l_val, pc in zip(it_h, it_l, it_pc):
        hl = h - l_val
        hpc = abs(h - pc)
        lpc = abs(l_val - pc)

        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc

        # Smoothed ATR update rule: ATR_i = ATR_{i-1} + (TR_i - ATR_{i-1}) / period
        val += (tr - val) * inv_period

    return val
