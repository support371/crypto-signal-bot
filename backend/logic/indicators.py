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

    prev = values[0]
    for i in range(1, period + 1):
        curr = values[i]
        change = curr - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = curr

    avg_gain *= inv_period
    avg_loss *= inv_period

    # Wilder smoothing for the rest
    for i in range(period + 1, n):
        curr = values[i]
        change = curr - prev
        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period
        prev = curr

    if avg_loss == 0:
        return 100.0

    return 100.0 - (100.0 / (1 + avg_gain / avg_loss))


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
        ema_f = values[i] * k_fast + ema_f * (1 - k_fast)

    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max):
        ema_s = values[i] * k_slow + ema_s * (1 - k_slow)

    # Both EMAs are now at index p_max - 1. Calculate first MACD value.
    macd_val = ema_f - ema_s

    # 2. Seed Signal EMA
    # We need 'signal_period' MACD values to calculate the first signal SMA.
    macd_history = [macd_val]
    curr = p_max
    while len(macd_history) < signal_period:
        v = values[curr]
        ema_f = v * k_fast + ema_f * (1 - k_fast)
        ema_s = v * k_slow + ema_s * (1 - k_slow)
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
        ema_f = v * k_fast + ema_f * (1 - k_fast)
        ema_s = v * k_slow + ema_s * (1 - k_slow)
        macd_val = ema_f - ema_s
        sig_ema = macd_val * k_sig + sig_ema * (1 - k_sig)

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
    for i in range(1, period + 1):
        h = highs[i]
        l = lows[i]
        pc = closes[i-1]

        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)

        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr

    val = tr_sum * inv_period

    # Wilder smoothing for the rest
    for i in range(period + 1, n):
        h = highs[i]
        l = lows[i]
        pc = closes[i-1]

        hl = h - l
        hpc = abs(h - pc)
        lpc = abs(l - pc)

        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc

        # Smoothed ATR update rule: ATR_i = ATR_{i-1} + (TR_i - ATR_{i-1}) / period
        val = val + (tr - val) * inv_period

    return val
