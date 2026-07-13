
import time
import random
import itertools

def ema_current(values, period):
    if not values or period <= 0:
        return [None] * len(values)
    result = [None] * len(values)
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

def ema_no_idx(values, period):
    if not values or period <= 0:
        return [None] * len(values)
    n = len(values)
    result = [None] * n
    if n < period:
        return result
    k = 2.0 / (period + 1)

    seed = sum(values[:period]) / period
    result[period - 1] = seed

    prev = seed
    # Test if range is faster than enumerate
    for i in range(period, n):
        prev += k * (values[i] - prev)
        result[i] = prev
    return result

def benchmark():
    n = 100000
    period = 200
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking ema (series) with N={n}, period={period}")

    # Warmup
    for _ in range(10):
        _ = ema_current(values, period)
        _ = ema_no_idx(values, period)

    iterations = 100

    start = time.perf_counter()
    for _ in range(iterations):
        _ = ema_current(values, period)
    end = time.perf_counter()
    current_time = (end - start) / iterations
    print(f"ema (current): {current_time*1e6:.4f} us per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = ema_no_idx(values, period)
    end = time.perf_counter()
    opt_time = (end - start) / iterations
    print(f"ema (no_idx): {opt_time*1e6:.4f} us per call")

    print(f"Improvement: {(current_time - opt_time) / current_time * 100:.2f}%")

if __name__ == "__main__":
    benchmark()
