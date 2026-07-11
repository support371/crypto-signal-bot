
import time
import random
import itertools
import math

def last_ema_current(values, period):
    if len(values) < period or period <= 0: return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for i in range(period, len(values)):
        val += k * (values[i] - val)
    return val

def last_ema_opt(values, period):
    if len(values) < period or period <= 0: return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for x in itertools.islice(values, period, None):
        val += k * (x - val)
    return val

def last_rsi_current(values, period=14):
    n = len(values)
    if n < period + 1 or period <= 0: return None
    inv_period = 1.0 / period
    minus_one_over_period = (period - 1) * inv_period
    avg_gain = 0.0
    avg_loss = 0.0
    prev = values[0]
    for i in range(1, period + 1):
        curr = values[i]
        change = curr - prev
        if change > 0: avg_gain += change
        else: avg_loss -= change
        prev = curr
    avg_gain *= inv_period
    avg_loss *= inv_period
    for i in range(period + 1, n):
        curr = values[i]
        change = curr - prev
        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0: avg_gain += change * inv_period
        elif change < 0: avg_loss -= change * inv_period
        prev = curr
    total = avg_gain + avg_loss
    if total == 0: return 50.0
    return 100.0 * avg_gain / total

def last_rsi_opt(values, period=14):
    n = len(values)
    if n < period + 1 or period <= 0: return None
    inv_period = 1.0 / period
    minus_one_over_period = (period - 1) * inv_period
    avg_gain = 0.0
    avg_loss = 0.0
    prev = values[0]
    for i in range(1, period + 1):
        curr = values[i]
        change = curr - prev
        if change > 0: avg_gain += change
        else: avg_loss -= change
        prev = curr
    avg_gain *= inv_period
    avg_loss *= inv_period
    it = itertools.islice(values, period + 1, None)
    for curr in it:
        change = curr - prev
        avg_gain *= minus_one_over_period
        avg_loss *= minus_one_over_period
        if change > 0: avg_gain += change * inv_period
        elif change < 0: avg_loss -= change * inv_period
        prev = curr
    total = avg_gain + avg_loss
    if total == 0: return 50.0
    return 100.0 * avg_gain / total

def last_atr_current(highs, lows, closes, period=14):
    n = len(closes)
    if len(highs) != n or len(lows) != n: return None
    if n < period + 1 or period <= 0: return None
    inv_period = 1.0 / period
    tr_sum = 0.0
    for i in range(1, period + 1):
        h = highs[i]
        low_val = lows[i]
        pc = closes[i - 1]
        hl = h - low_val
        hpc = abs(h - pc)
        lpc = abs(low_val - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr
    val = tr_sum * inv_period
    for i in range(period + 1, n):
        h = highs[i]
        low_val = lows[i]
        pc = closes[i - 1]
        hl = h - low_val
        hpc = abs(h - pc)
        lpc = abs(low_val - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        val = val + (tr - val) * inv_period
    return val

def last_atr_opt(highs, lows, closes, period=14):
    n = len(closes)
    if len(highs) != n or len(lows) != n: return None
    if n < period + 1 or period <= 0: return None
    inv_period = 1.0 / period
    tr_sum = 0.0
    for i in range(1, period + 1):
        h = highs[i]
        low_val = lows[i]
        pc = closes[i - 1]
        hl = h - low_val
        hpc = abs(h - pc)
        lpc = abs(low_val - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        tr_sum += tr
    val = tr_sum * inv_period
    it = itertools.islice(zip(highs, lows, closes), period, None)
    _, _, pc = next(it)
    for h, low_val, curr_c in it:
        hl = h - low_val
        hpc = abs(h - pc)
        lpc = abs(low_val - pc)
        tr = hl
        if hpc > tr: tr = hpc
        if lpc > tr: tr = lpc
        val += (tr - val) * inv_period
        pc = curr_c
    return val

def last_macd_current(values, fast=12, slow=26, signal_period=9, count=1):
    n = len(values)
    p_max = max(fast, slow)
    if n < p_max + signal_period - 1 or fast <= 0 or slow <= 0 or signal_period <= 0:
        return (None, None, None) if count == 1 else []
    k_fast = 2.0 / (fast + 1)
    k_slow = 2.0 / (slow + 1)
    k_sig = 2.0 / (signal_period + 1)
    ema_f = sum(values[:fast]) / fast
    for i in range(fast, p_max): ema_f += k_fast * (values[i] - ema_f)
    ema_s = sum(values[:slow]) / slow
    for i in range(slow, p_max): ema_s += k_slow * (values[i] - ema_s)
    macd_val = ema_f - ema_s
    macd_history = [macd_val]
    curr = p_max
    while len(macd_history) < signal_period:
        v = values[curr]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        macd_history.append(macd_val)
        curr += 1
    sig_ema = sum(macd_history) / signal_period
    results = []
    if curr >= n - count + 1:
        results.append((macd_history[-1], sig_ema, macd_history[-1] - sig_ema))
    for i in range(curr, n):
        v = values[i]
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        sig_ema += k_sig * (macd_val - sig_ema)
        if i >= n - count: results.append((macd_val, sig_ema, macd_val - sig_ema))
    return results[-1] if count == 1 else results

def last_macd_opt(values, fast=12, slow=26, signal_period=9, count=1):
    n = len(values)
    p_max = max(fast, slow)
    if n < p_max + signal_period - 1 or fast <= 0 or slow <= 0 or signal_period <= 0:
        return (None, None, None) if count == 1 else []
    k_fast = 2.0 / (fast + 1)
    k_slow = 2.0 / (slow + 1)
    k_sig = 2.0 / (signal_period + 1)
    ema_f = sum(values[:fast]) / fast
    for x in itertools.islice(values, fast, p_max): ema_f += k_fast * (x - ema_f)
    ema_s = sum(values[:slow]) / slow
    for x in itertools.islice(values, slow, p_max): ema_s += k_slow * (x - ema_s)
    macd_val = ema_f - ema_s
    macd_history = [macd_val]
    it = itertools.islice(values, p_max, None)
    while len(macd_history) < signal_period:
        v = next(it)
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        macd_history.append(macd_val)
    sig_ema = sum(macd_history) / signal_period
    results = []
    curr_idx = p_max + signal_period - 1
    if curr_idx >= n - count:
        results.append((macd_val, sig_ema, macd_val - sig_ema))
    for v in it:
        curr_idx += 1
        ema_f += k_fast * (v - ema_f)
        ema_s += k_slow * (v - ema_s)
        macd_val = ema_f - ema_s
        sig_ema += k_sig * (macd_val - sig_ema)
        if curr_idx >= n - count: results.append((macd_val, sig_ema, macd_val - sig_ema))
    return results[-1] if count == 1 else results

def benchmark():
    n = 1000000
    period = 14
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    print(f"Benchmarking indicators with N={n}")

    # last_ema
    start = time.perf_counter()
    _ = last_ema_current(closes, 200)
    end = time.perf_counter()
    t1 = end - start
    start = time.perf_counter()
    _ = last_ema_opt(closes, 200)
    end = time.perf_counter()
    t2 = end - start
    print(f"last_ema:  {(t1-t2)/t1*100:.1f}% improvement")

    # last_rsi
    start = time.perf_counter()
    _ = last_rsi_current(closes, 14)
    end = time.perf_counter()
    t1 = end - start
    start = time.perf_counter()
    _ = last_rsi_opt(closes, 14)
    end = time.perf_counter()
    t2 = end - start
    print(f"last_rsi:  {(t1-t2)/t1*100:.1f}% improvement")

    # last_atr
    start = time.perf_counter()
    _ = last_atr_current(highs, lows, closes, 14)
    end = time.perf_counter()
    t1 = end - start
    start = time.perf_counter()
    _ = last_atr_opt(highs, lows, closes, 14)
    end = time.perf_counter()
    t2 = end - start
    print(f"last_atr:  {(t1-t2)/t1*100:.1f}% improvement")

    # last_macd
    start = time.perf_counter()
    _ = last_macd_current(closes)
    end = time.perf_counter()
    t1 = end - start
    start = time.perf_counter()
    _ = last_macd_opt(closes)
    end = time.perf_counter()
    t2 = end - start
    print(f"last_macd: {(t1-t2)/t1*100:.1f}% improvement")

if __name__ == "__main__":
    benchmark()
