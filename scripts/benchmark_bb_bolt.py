
import time
import random
import itertools
import math

def bb_current(values, period=20, num_std=2.0):
    n = len(values)
    upper = [None] * n
    middle = [None] * n
    lower = [None] * n
    if n < period or period <= 0: return upper, middle, lower
    inv_period = 1.0 / period
    current_sum = 0.0
    current_sq_sum = 0.0
    for i in range(period - 1):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val
    for i in range(period - 1, n):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val
        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        std = math.sqrt(max(variance, 0.0))
        middle[i] = sma
        offset = num_std * std
        upper[i] = sma + offset
        lower[i] = sma - offset
        old_val = values[i - period + 1]
        current_sum -= old_val
        current_sq_sum -= old_val * old_val
    return upper, middle, lower

def bb_opt(values, period=20, num_std=2.0):
    n = len(values)
    upper = [None] * n
    middle = [None] * n
    lower = [None] * n
    if n < period or period <= 0: return upper, middle, lower
    inv_period = 1.0 / period
    current_sum = 0.0
    current_sq_sum = 0.0
    # Initialization
    for val in itertools.islice(values, period - 1):
        current_sum += val
        current_sq_sum += val * val

    it_new = itertools.islice(values, period - 1, None)
    it_old = itertools.islice(values, None)

    for i, (val, old_val) in enumerate(zip(it_new, it_old), start=period - 1):
        current_sum += val
        current_sq_sum += val * val
        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        std = math.sqrt(variance if variance > 0 else 0.0)
        middle[i] = sma
        offset = num_std * std
        upper[i] = sma + offset
        lower[i] = sma - offset
        current_sum -= old_val
        current_sq_sum -= old_val * old_val
    return upper, middle, lower

def benchmark():
    n = 1000000
    period = 20
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking Bollinger Bands with N={n}")

    start = time.perf_counter()
    _ = bb_current(values, period)
    end = time.perf_counter()
    t1 = end - start
    print(f"bb_current: {t1:.4f}s")

    start = time.perf_counter()
    _ = bb_opt(values, period)
    end = time.perf_counter()
    t2 = end - start
    print(f"bb_opt:     {t2:.4f}s ({(t1-t2)/t1*100:.1f}% improvement)")

if __name__ == "__main__":
    benchmark()
