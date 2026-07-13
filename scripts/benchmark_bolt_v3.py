
import time
import random
import itertools

def last_ema_current(values, period):
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
    it = iter(values)
    val = sum(itertools.islice(it, period)) / period
    for v in it:
        val += k * (v - val)
    return val

def benchmark():
    n = 100000
    period = 200
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking last_ema with N={n}, period={period}")

    # Warmup
    for _ in range(100):
        _ = last_ema_current(values, period)
        _ = last_ema_islice(values, period)

    iterations = 500

    start = time.perf_counter()
    for _ in range(iterations):
        _ = last_ema_current(values, period)
    end = time.perf_counter()
    current_time = (end - start) / iterations
    print(f"last_ema (current): {current_time*1e6:.4f} us per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = last_ema_islice(values, period)
    end = time.perf_counter()
    opt_time = (end - start) / iterations
    print(f"last_ema (islice): {opt_time*1e6:.4f} us per call")

    print(f"Improvement: {(current_time - opt_time) / current_time * 100:.2f}%")

    # Verify correctness
    v1 = last_ema_current(values, period)
    v2 = last_ema_islice(values, period)
    print(f"Correctness check: {v1} == {v2} ? {abs(v1-v2) < 1e-10}")

if __name__ == "__main__":
    benchmark()
