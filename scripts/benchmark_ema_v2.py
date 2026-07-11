
import time
import random
import itertools

def last_ema_range(values, period):
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for i in range(period, len(values)):
        val += k * (values[i] - val)
    return val

def last_ema_islice(values, period):
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for x in itertools.islice(values, period, None):
        val += k * (x - val)
    return val

def benchmark():
    n = 1000000
    period = 14
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking last_ema with N={n}, period={period}")

    # Warmup
    for _ in range(5):
        _ = last_ema_range(values, period)
        _ = last_ema_islice(values, period)

    iterations = 20

    start = time.perf_counter()
    for _ in range(iterations):
        _ = last_ema_range(values, period)
    end = time.perf_counter()
    range_time = (end - start) / iterations
    print(f"last_ema (range): {range_time:.4f}s per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = last_ema_islice(values, period)
    end = time.perf_counter()
    islice_time = (end - start) / iterations
    print(f"last_ema (islice): {islice_time:.4f}s per call")

    print(f"Improvement: {(range_time - islice_time) / range_time * 100:.2f}%")

if __name__ == "__main__":
    benchmark()
