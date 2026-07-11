
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

def ema_opt(values, period):
    if not values or period <= 0:
        return [None] * len(values)
    n = len(values)
    result = [None] * n
    k = 2.0 / (period + 1)
    seed_idx = period - 1
    if n < period:
        return result
    seed = sum(values[:period]) / period
    result[seed_idx] = seed
    prev = seed
    for i, x in enumerate(itertools.islice(values, seed_idx + 1, None), start=seed_idx + 1):
        prev += k * (x - prev)
        result[i] = prev
    return result

def benchmark():
    n = 1000000
    period = 14
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking EMA series with N={n}")

    start = time.perf_counter()
    _ = ema_current(values, period)
    end = time.perf_counter()
    t1 = end - start
    print(f"ema_current: {t1:.4f}s")

    start = time.perf_counter()
    _ = ema_opt(values, period)
    end = time.perf_counter()
    t2 = end - start
    print(f"ema_opt:     {t2:.4f}s ({(t1-t2)/t1*100:.1f}% improvement)")

if __name__ == "__main__":
    benchmark()
