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
    Optimized with iterator-based loop to reduce indexing overhead.
    """
    n = len(values)
    if not values or period <= 0 or n < period:
        return [None] * n

    k = 2.0 / (period + 1)

    # Seed with SMA
    seed = sum(islice(values, period)) / period

    result: List[Optional[float]] = [None] * (period - 1)
    result.append(seed)

    prev = seed
    # Progressively calculate EMA for the rest
    for val in islice(values, period, None):
        # Simplified update rule: val += k * (input - val)
        prev += k * (val - prev)
        result.append(prev)

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
    val = sum(islice(values, period)) / period

    # Progressively calculate EMA for the rest
    # Using simplified update rule: val += k * (input - val)
    for v in islice(values, period, None):
        val += k * (v - val)

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
    Using iterator-based loops for improved performance.
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n

    inv_period = 1.0 / period
    avg_gain = 0.0
    avg_loss = 0.0

    # Initial seed: SMA of first 'period' gains/losses
    it_curr = islice(values, 1, period + 1)
    it_prev = islice(values, period)

    # Track last prev value for the smoothing loop
    last_val = values[0]
    for curr, prev_val in zip(it_curr, it_prev):
        change = curr - prev_val
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        last_val = curr

    avg_gain *= inv_period
    avg_loss *= inv_period

    result: List[Optional[float]] = [None] * period

    # Use combined formula for RSI to reduce divisions: 100 * gain / (gain + loss)
    total = avg_gain + avg_loss
    if total == 0:
        result.append(50.0)
    else:
        result.append(100.0 * avg_gain / total)

    # Wilder smoothing for the rest
    minus_one_over_period = (period - 1) * inv_period
    it_curr = islice(values, period + 1, None)

    for curr in it_curr:
        change = curr - last_val
        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period

        total = avg_gain + avg_loss
        if total == 0:
            result.append(50.0)
        else:
            result.append(100.0 * avg_gain / total)
        last_val = curr

    return result


def last_rsi(values: List[float], period: int = 14) -> Optional[float]:
    """
    Return the most recent RSI value.
    Optimized to O(n) time and O(1) space by avoiding list allocations for changes, gains, and losses.
    Further optimized by reducing arithmetic operations and list indexing.
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return None

    inv_period = 1.0 / period
    minus_one_over_period = (period - 1) * inv_period

    # Initial averages
    avg_gain = 0.0
    avg_loss = 0.0

    it_curr = islice(values, 1, period + 1)
    it_prev = islice(values, period)

    last_val = values[0]
    for curr, prev_val in zip(it_curr, it_prev):
        change = curr - prev_val
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        last_val = curr

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Wilder smoothing for the rest
    for curr in islice(values, period + 1, None):
        change = curr - last_val
        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period
        last_val = curr

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
    ema_f = sum(islice(values, fast)) / fast
    for v in islice(values, fast, p_max):
        ema_f += k_fast * (v - ema_f)

    ema_s = sum(islice(values, slow)) / slow
    for v in islice(values, slow, p_max):
        ema_s += k_slow * (v - ema_s)

    # First MACD value at index p_max - 1
    m_val = ema_f - ema_s
    macd_line[p_max - 1] = m_val

    # 2. Progress until we can seed the signal line
    # Signal starts after 'signal_period' MACD values.
    # The first signal value is the SMA of the first 'signal_period' MACD values.
    macd_sum = m_val
    signal_start_idx = p_max + signal_period - 2
    curr = p_max

    # Use islice for the bridging loops
    it_values = islice(values, p_max, None)

    # Bridge to signal start
    for _ in range(signal_start_idx - p_max):
        try:
            v = next(it_values)
            ema_f += k_fast * (v - ema_f)
            ema_s += k_slow * (v - ema_s)
            m_val = ema_f - ema_s
            macd_line[curr] = m_val
            macd_sum += m_val
            curr += 1
        except StopIteration:
            break

    if curr == signal_start_idx:
        try:
            v = next(it_values)
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
            for v in it_values:
                ema_f += k_fast * (v - ema_f)
                ema_s += k_slow * (v - ema_s)
                m_val = ema_f - ema_s
                sig_ema += k_sig * (m_val - sig_ema)

                macd_line[curr] = m_val
                signal_line[curr] = sig_ema
                histogram[curr] = m_val - sig_ema
                curr += 1
        except StopIteration:
            pass

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
    ema_f = sum(islice(values, fast)) / fast
    for v in islice(values, fast, p_max):
        ema_f += k_fast * (v - ema_f)

    ema_s = sum(islice(values, slow)) / slow
    for v in islice(values, slow, p_max):
        ema_s += k_slow * (v - ema_s)

    # Both EMAs are now at index p_max - 1. Calculate first MACD value.
    macd_val = ema_f - ema_s

    # 2. Seed Signal EMA
    # We need 'signal_period' MACD values to calculate the first signal SMA.
    macd_history = [macd_val]
    it_values = islice(values, p_max, None)

    curr = p_max
    while len(macd_history) < signal_period:
        try:
            v = next(it_values)
            ema_f += k_fast * (v - ema_f)
            ema_s += k_slow * (v - ema_s)
            macd_val = ema_f - ema_s
            macd_history.append(macd_val)
            curr += 1
        except StopIteration:
            break

    # First signal EMA value is the SMA of the first 'signal_period' MACD values.
    # This corresponds to original index (p_max - 1) + (signal_period - 1).
    sig_ema = sum(macd_history) / signal_period

    results = []
    # If the current index is within the 'count' range, capture the result.
    if curr >= n - count + 1:
        results.append((macd_history[-1], sig_ema, macd_history[-1] - sig_ema))

    # 3. Process remaining bars iteratively
    for v in it_values:
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        sig_ema += k_sig * (macd_val - sig_ema)

        if curr >= n - count:
            results.append((macd_val, sig_ema, macd_val - sig_ema))
        curr += 1

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
    Further optimized by replacing range indexing with islice and zip iterators.
    """
    n = len(values)
    if n < period or period <= 0:
        return [None] * n, [None] * n, [None] * n

    inv_period = 1.0 / period
    current_sum = 0.0
    current_sq_sum = 0.0

    # 1. Prime the sums for the first window (excluding the last element)
    for val in islice(values, period - 1):
        current_sum += val
        current_sq_sum += val * val

    upper: List[Optional[float]] = [None] * (period - 1)
    middle: List[Optional[float]] = [None] * (period - 1)
    lower: List[Optional[float]] = [None] * (period - 1)

    it_new = islice(values, period - 1, None)
    it_old = iter(values)

    # 2. Main loop: process elements using iterators
    for val, old_val in zip(it_new, it_old):
        current_sum += val
        current_sq_sum += val * val

        # Calculate SMA and Variance: Variance = E[X^2] - (E[X])^2
        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        # Safeguard against tiny negative numbers due to floating point precision
        std = math.sqrt(variance if variance > 0 else 0.0)

        middle.append(sma)
        offset = num_std * std
        upper.append(sma + offset)
        lower.append(sma - offset)

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
    std = math.sqrt(variance if variance > 0 else 0.0)

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
    Optimized to O(n) without intermediate list allocations.
    Algebraically simplified update rule for Wilder smoothing:
    val += (tr - val) / period
    Using iterator-based loops for improved performance.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        raise ValueError("highs, lows, closes must be same length")
    if n < period + 1 or period <= 0:
        return [None] * n

    inv_period = 1.0 / period

    # Seed with simple average of first `period` TRs
    tr_sum = 0.0

    it_high = islice(highs, 1, period + 1)
    it_low = islice(lows, 1, period + 1)
    it_pc = islice(closes, period)

    for h, l, pc in zip(it_high, it_low, it_pc):
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)
        # Manually find max for performance
        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period
    result: List[Optional[float]] = [None] * period
    result.append(val)

    # Wilder smoothing for the rest
    it_high = islice(highs, period + 1, None)
    it_low = islice(lows, period + 1, None)
    it_pc = islice(closes, period, None)

    for h, l, pc in zip(it_high, it_low, it_pc):
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)

        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc

        # val = (val * (period - 1) + tr) / period
        # Simplified: val += (tr - val) / period
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
    Further optimized by removing internal function calls and streamlining Wilder smoothing.
    """
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        return None
    if n < period + 1 or period <= 0:
        return None

    inv_period = 1.0 / period
    tr_sum = 0.0

    # Seed with average of first 'period' TRs
    it_high = islice(highs, 1, period + 1)
    it_low = islice(lows, 1, period + 1)
    it_pc = islice(closes, period)

    for h, l, pc in zip(it_high, it_low, it_pc):
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)

        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period

    # Wilder smoothing for the rest
    it_high = islice(highs, period + 1, None)
    it_low = islice(lows, period + 1, None)
    it_pc = islice(closes, period, None)

    for h, l, pc in zip(it_high, it_low, it_pc):
        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)

        tr = hl
        if hpc > tr:
            tr = hpc
        if lpc > tr:
            tr = lpc

        # Smoothed ATR update rule: ATR_i = ATR_{i-1} + (TR_i - ATR_{i-1}) / period
        val = val + (tr - val) * inv_period

    return val
