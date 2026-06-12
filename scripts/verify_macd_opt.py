
import time
import random
from typing import List, Optional, Tuple
from backend.logic.indicators import ema, macd as original_macd

def optimized_macd(
    values: List[float],
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """
    Optimized MACD line, signal line, histogram.
    Returns three lists of same length as `values`.
    Single-pass O(N) implementation.
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
        ema_f = values[i] * k_fast + ema_f * (1 - k_fast)

    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max):
        ema_s = values[i] * k_slow + ema_s * (1 - k_slow)

    # First MACD value at index p_max - 1
    m_val = ema_f - ema_s
    macd_line[p_max - 1] = m_val

    # 2. Progress until we can seed the signal line
    # We need 'signal_period' non-None MACD values to seed signal SMA
    macd_sum = m_val
    curr = p_max

    # We want to stop just before the index where signal starts.
    # Signal starts at p_max - 1 + signal_period - 1
    signal_start_idx = p_max + signal_period - 2

    while curr < n and curr < signal_start_idx:
        v = values[curr]
        ema_f = v * k_fast + ema_f * (1 - k_fast)
        ema_s = v * k_slow + ema_s * (1 - k_slow)
        m_val = ema_f - ema_s
        macd_line[curr] = m_val
        macd_sum += m_val
        curr += 1

    if curr == signal_start_idx and curr < n:
        # Seed signal SMA at signal_start_idx
        v = values[curr]
        ema_f = v * k_fast + ema_f * (1 - k_fast)
        ema_s = v * k_slow + ema_s * (1 - k_slow)
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
            ema_f = v * k_fast + ema_f * (1 - k_fast)
            ema_s = v * k_slow + ema_s * (1 - k_slow)
            m_val = ema_f - ema_s
            sig_ema = m_val * k_sig + sig_ema * (1 - k_sig)

            macd_line[i] = m_val
            signal_line[i] = sig_ema
            histogram[i] = m_val - sig_ema

    return macd_line, signal_line, histogram

def verify():
    n = 1000
    fast, slow, signal = 12, 26, 9
    values = [random.uniform(100, 200) for _ in range(n)]

    ml1, sl1, h1 = original_macd(values, fast, slow, signal)
    ml2, sl2, h2 = optimized_macd(values, fast, slow, signal)

    for i in range(n):
        v1 = (ml1[i], sl1[i], h1[i])
        v2 = (ml2[i], sl2[i], h2[i])

        for a, b in zip(v1, v2):
            if a is None or b is None:
                if a != b:
                    print(f"Mismatch at index {i}: {v1} != {v2}")
                    return False
            elif abs(a - b) > 1e-9:
                print(f"Mismatch at index {i}: {v1} != {v2}")
                return False

    print("Verification SUCCESS: Optimized MACD matches original.")
    return True

if __name__ == "__main__":
    verify()
