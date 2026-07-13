
import time
import random
import itertools

def rsi_current(values, period=14):
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n
    result = [None] * n
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

def rsi_opt(values, period=14):
    n = len(values)
    if n < period + 1 or period <= 0:
        return [None] * n
    result = [None] * n
    inv_period = 1.0 / period
    avg_gain = 0.0
    avg_loss = 0.0
    it = iter(values)
    prev = next(it)
    for _ in range(period):
        curr = next(it)
        change = curr - prev
        if change > 0:
            avg_gain += change
        else:
            avg_loss -= change
        prev = curr
    avg_gain *= inv_period
    avg_loss *= inv_period
    total = avg_gain + avg_loss
    result[period] = 50.0 if total == 0 else 100.0 * avg_gain / total
    prev_weight = (period - 1) * inv_period
    for i, curr in enumerate(it, start=period + 1):
        change = curr - prev
        avg_gain *= prev_weight
        avg_loss *= prev_weight
        if change > 0:
            avg_gain += change * inv_period
        elif change < 0:
            avg_loss -= change * inv_period
        total = avg_gain + avg_loss
        result[i] = 50.0 if total == 0 else 100.0 * avg_gain / total
        prev = curr
    return result

def benchmark():
    n = 100000
    period = 14
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking rsi with N={n}, period={period}")

    # Warmup
    for _ in range(10):
        _ = rsi_current(values, period)
        _ = rsi_opt(values, period)

    iterations = 100

    start = time.perf_counter()
    for _ in range(iterations):
        _ = rsi_current(values, period)
    end = time.perf_counter()
    current_time = (end - start) / iterations
    print(f"rsi (current): {current_time*1e6:.4f} us per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = rsi_opt(values, period)
    end = time.perf_counter()
    opt_time = (end - start) / iterations
    print(f"rsi (optimized): {opt_time*1e6:.4f} us per call")

    print(f"Improvement: {(current_time - opt_time) / current_time * 100:.2f}%")

    # Correctness
    res1 = rsi_current(values, period)
    res2 = rsi_opt(values, period)
    print(f"Correctness check: {res1[-1]} == {res2[-1]} ? {abs(res1[-1]-res2[-1]) < 1e-10}")

if __name__ == "__main__":
    benchmark()
