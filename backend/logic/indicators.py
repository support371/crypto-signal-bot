# backend/logic/indicators.py
"""
Technical indicator library — pure functions, no side effects.

All functions operate on plain Python lists of floats (close prices,
high, low, volume) so they can be used in tests without any framework.

Functions return None (or list with None padding) when there is
insufficient data rather than raising.
"""
from __future__ import annotations

import itertools
import math
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
    # Use enumerate with islice to avoid O(N) indexing overhead in CPython
    for i, val in enumerate(itertools.islice(values, seed_idx + 1, None), start=seed_idx + 1):
        # Simplified update rule: val += k * (input - val)
        prev += k * (val - prev)
        result[i] = prev

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
    # Using simplified update rule: val += k * (input - val)
    # Use itertools.islice to avoid O(N) indexing overhead in CPython
    for v in itertools.islice(values, period, None):
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
    """
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n

    result: List[Optional[float]] = [None] * n

    inv_period = 1.0 / period

    avg_gain = 0.0
    avg_loss = 0.0

    # Initial seed: SMA of first 'period' gains/losses
    # Use islice and zip to avoid manual indexing
    vals_iter = iter(values)
    prev = next(vals_iter)
    for curr in itertools.islice(vals_iter, period):
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
    if total == 0:
        result[period] = 50.0
    else:
        result[period] = 100.0 * avg_gain / total

    # Wilder smoothing for the rest
    minus_one_over_period = (period - 1) * inv_period
    # Use enumerate with islice to avoid O(N) indexing overhead in CPython
    for i, curr in enumerate(itertools.islice(values, period + 1, None), start=period + 1):
        change = curr - prev

        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
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

    # Use islice and zip to avoid manual indexing
    vals_iter = iter(values)
    prev = next(vals_iter)
    for curr in itertools.islice(vals_iter, period):
        change = curr - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = curr

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Wilder smoothing for the rest
    for curr in itertools.islice(values, period + 1, None):
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
    ema_f = sum(values[:fast]) / fast
    for val in itertools.islice(values, fast, p_max):
        ema_f += k_fast * (val - ema_f)

    ema_s = sum(values[:slow]) / slow
    for val in itertools.islice(values, slow, p_max):
        ema_s += k_slow * (val - ema_s)

    # First MACD value at index p_max - 1
    m_val = ema_f - ema_s
    macd_line[p_max - 1] = m_val

    # 2. Progress until we can seed the signal line
    # Signal starts after 'signal_period' MACD values.
    # The first signal value is the SMA of the first 'signal_period' MACD values.
    macd_sum = m_val
    signal_start_idx = p_max + signal_period - 2
    curr_idx = p_max

    # Use islice to progress without manual indexing where possible
    # We use enumerate for the macd_line/signal_line/histogram assignment
    prog_iter = enumerate(itertools.islice(values, p_max, signal_start_idx), start=p_max)
    for i, v in prog_iter:
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        m_val = ema_f - ema_s
        macd_line[i] = m_val
        macd_sum += m_val
        curr_idx = i + 1

    if curr_idx == signal_start_idx and curr_idx < n:
        # Seed signal SMA at signal_start_idx
        v = values[curr_idx]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        m_val = ema_f - ema_s
        macd_line[curr_idx] = m_val
        macd_sum += m_val

        sig_ema = macd_sum / signal_period
        signal_line[curr_idx] = sig_ema
        histogram[curr_idx] = m_val - sig_ema
        curr_idx += 1

        # 3. Process remaining bars
        for i, v in enumerate(itertools.islice(values, curr_idx, None), start=curr_idx):
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
    for val in itertools.islice(values, fast, p_max):
        ema_f += k_fast * (val - ema_f)

    ema_s = sum(values[:slow]) / slow
    for val in itertools.islice(values, slow, p_max):
        ema_s += k_slow * (val - ema_s)

    # Both EMAs are now at index p_max - 1. Calculate first MACD value.
    macd_val = ema_f - ema_s

    # 2. Seed Signal EMA
    # We need 'signal_period' MACD values to calculate the first signal SMA.
    macd_history = [macd_val]
    # Use enumerate with islice to track original index while avoiding range()
    seed_iter = enumerate(itertools.islice(values, p_max, p_max + signal_period - 1), start=p_max)
    curr_idx = p_max
    for i, v in seed_iter:
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        macd_history.append(macd_val)
        curr_idx = i + 1

    # First signal EMA value is the SMA of the first 'signal_period' MACD values.
    # This corresponds to original index (p_max - 1) + (signal_period - 1).
    sig_ema = sum(macd_history) / signal_period

    results = []
    # If the current index is within the 'count' range, capture the result.
    # curr_idx is the index of the last processed value + 1
    if curr_idx > n - count:
        results.append((macd_history[-1], sig_ema, macd_history[-1] - sig_ema))

    # 3. Process remaining bars iteratively
    for i, v in enumerate(itertools.islice(values, curr_idx, None), start=curr_idx):
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

    # 1. Prime the sums for the first window
    for val in itertools.islice(values, period):
        current_sum += val
        current_sq_sum += val * val

    # 2. Calculate for the first full window at index 'period - 1'
    sma = current_sum * inv_period
    variance = (current_sq_sum * inv_period) - (sma * sma)
    std = math.sqrt(max(variance, 0.0))
    middle[period - 1] = sma
    offset = num_std * std
    upper[period - 1] = sma + offset
    lower[period - 1] = sma - offset

    # 3. Main loop: Use zip with islice to efficiently update rolling sums
    # zip(new_values, old_values)
    # new_values starts at index 'period'
    # old_values starts at index '0'
    for i, (new_val, old_val) in enumerate(zip(itertools.islice(values, period, None), values), start=period):
        current_sum += new_val - old_val
        current_sq_sum += new_val * new_val - old_val * old_val

        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        std = math.sqrt(max(variance, 0.0))

        middle[i] = sma
        offset = num_std * std
        upper[i] = sma + offset
        lower[i] = sma - offset

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
    Optimized to O(n) without intermediate list allocations.
    Algebraically simplified update rule for Wilder smoothing:
    val += (tr - val) / period
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
    # Use zip with islice to avoid manual indexing
    # TR at index i uses highs[i], lows[i] and closes[i-1]
    seed_iter = zip(
        itertools.islice(highs, 1, period + 1),
        itertools.islice(lows, 1, period + 1),
        itertools.islice(closes, 0, period),
    )
    for h, l, pc in seed_iter:
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
    result[period] = val

    # Wilder smoothing for the rest
    smooth_iter = enumerate(
        zip(
            itertools.islice(highs, period + 1, None),
            itertools.islice(lows, period + 1, None),
            itertools.islice(closes, period, None),
        ),
        start=period + 1,
    )
    for i, (h, l, pc) in smooth_iter:
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
    # Use zip with islice to avoid manual indexing
    seed_iter = zip(
        itertools.islice(highs, 1, period + 1),
        itertools.islice(lows, 1, period + 1),
        itertools.islice(closes, 0, period),
    )
    for h, l, pc in seed_iter:
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
    smooth_iter = zip(
        itertools.islice(highs, period + 1, None),
        itertools.islice(lows, period + 1, None),
        itertools.islice(closes, period, None),
    )
    for h, l, pc in smooth_iter:
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
