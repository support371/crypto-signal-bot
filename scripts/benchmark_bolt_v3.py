
import time
import random
import math
from typing import List, Optional, Tuple

# Baseline implementations (current code as of now)
def ema_baseline(values: List[float], period: int) -> List[Optional[float]]:
    if not values or period <= 0:
        return [None] * len(values)
    result: List[Optional[float]] = [None] * len(values)
    k = 2.0 / (period + 1)
    seed_idx = period - 1
    if len(values) < period:
        return result
    seed = sum(values[:period]) / period
    result[seed_idx] = seed
    prev = seed
    for i in range(seed_idx + 1, len(values)):
        prev += k * (values[i] - prev)
        result[i] = prev
    return result

def last_ema_baseline(values: List[float], period: int) -> Optional[float]:
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for i in range(period, len(values)):
        val += k * (values[i] - val)
    return val

def rsi_baseline(values: List[float], period: int = 14) -> List[Optional[float]]:
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n
    result: List[Optional[float]] = [None] * n
    inv_period = 1.0 / period
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
    total = avg_gain + avg_loss
    if total == 0:
        result[period] = 50.0
    else:
        result[period] = 100.0 * avg_gain / total
    minus_one_over_period = (period - 1) * inv_period
    for i in range(period + 1, n):
        curr = values[i]
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

def last_rsi_baseline(values: List[float], period: int = 14) -> Optional[float]:
    n = len(values)
    if n < period + 1 or period <= 0:
        return None
    inv_period = 1.0 / period
    minus_one_over_period = (period - 1) * inv_period
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
    total = avg_gain + avg_loss
    if total == 0:
        return 50.0
    return 100.0 * avg_gain / total

def atr_baseline(highs, lows, closes, period: int = 14) -> List[Optional[float]]:
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        raise ValueError("highs, lows, closes must be same length")
    if n < period + 1 or period <= 0:
        return [None] * n
    result: List[Optional[float]] = [None] * n
    inv_period = 1.0 / period
    tr_sum = 0.0
    for i in range(1, period + 1):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr
    val = tr_sum * inv_period
    result[period] = val
    for i in range(period + 1, n):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        val += (tr - val) * inv_period
        result[i] = val
    return result

def last_atr_baseline(highs, lows, closes, period: int = 14) -> Optional[float]:
    n = len(closes)
    if len(highs) != n or len(lows) != n: return None
    if n < period + 1 or period <= 0: return None
    inv_period = 1.0 / period
    tr_sum = 0.0
    for i in range(1, period + 1):
        h = highs[i]; low_val = lows[i]; pc = closes[i - 1]
        hl = h - low_val; hpc = abs(h - pc); lpc = abs(low_val - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr
    val = tr_sum * inv_period
    for i in range(period + 1, n):
        h = highs[i]; low_val = lows[i]; pc = closes[i - 1]
        hl = h - low_val; hpc = abs(h - pc); lpc = abs(low_val - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        val = val + (tr - val) * inv_period
    return val

def benchmark_and_verify():
    import types
    import os

    # Manually load the indicators file to avoid complex package imports
    with open("backend/logic/indicators.py", "r") as f:
        code = f.read()

    indicators = types.ModuleType("indicators")
    # Mock some basic types/imports if needed by the code
    indicators.__dict__["List"] = List
    indicators.__dict__["Optional"] = Optional
    indicators.__dict__["Tuple"] = Tuple
    indicators.__dict__["Any"] = Any
    indicators.__dict__["math"] = math

    # We need to handle the 'from __future__ import annotations' which might be there
    exec(code, indicators.__dict__)

    n = 100000
    period = 14
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    funcs = [
        ("EMA", ema_baseline, indicators.ema, (closes, period)),
        ("Last EMA", last_ema_baseline, indicators.last_ema, (closes, period)),
        ("RSI", rsi_baseline, indicators.rsi, (closes, period)),
        ("Last RSI", last_rsi_baseline, indicators.last_rsi, (closes, period)),
        ("ATR", atr_baseline, indicators.atr, (highs, lows, closes, period)),
        ("Last ATR", last_atr_baseline, indicators.last_atr, (highs, lows, closes, period)),
    ]

    print(f"{'Indicator':<15} | {'Baseline (s)':<15} | {'Optimized (s)':<15} | {'Speedup':<10} | {'Status'}")
    print("-" * 80)

    for name, base_fn, opt_fn, args in funcs:
        # Verify
        res_base = base_fn(*args)
        res_opt = opt_fn(*args)

        match = False
        if isinstance(res_base, list):
            match = all((a is None and b is None) or (a is not None and b is not None and abs(a - b) < 1e-9)
                        for a, b in zip(res_base, res_opt))
        elif res_base is None:
            match = res_opt is None
        else:
            match = abs(res_base - res_opt) < 1e-9

        status = "PASS" if match else "FAIL"

        # Benchmark
        start = time.perf_counter()
        for _ in range(5):
            _ = base_fn(*args)
        t_base = (time.perf_counter() - start) / 5

        start = time.perf_counter()
        for _ in range(5):
            _ = opt_fn(*args)
        t_opt = (time.perf_counter() - start) / 5

        speedup = t_base / t_opt if t_opt > 0 else 0
        print(f"{name:<15} | {t_base:<15.6f} | {t_opt:<15.6f} | {speedup:<10.2f}x | {status}")

if __name__ == "__main__":
    from typing import Any
    benchmark_and_verify()
