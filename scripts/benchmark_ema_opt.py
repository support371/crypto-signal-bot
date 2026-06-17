
import time
import random

def current_last_ema(values, period):
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for i in range(period, len(values)):
        val = values[i] * k + val * (1 - k)
    return val

def optimized_last_ema(values, period):
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for i in range(period, len(values)):
        val += k * (values[i] - val)
    return val

def benchmark():
    n = 1000
    period = 200
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking last_ema with N={n}, period={period}")

    # Warmup
    for _ in range(100):
        _ = current_last_ema(values, period)
        _ = optimized_last_ema(values, period)

    iterations = 50000

    start = time.perf_counter()
    for _ in range(iterations):
        _ = current_last_ema(values, period)
    end = time.perf_counter()
    current_time = (end - start) / iterations
    print(f"last_ema (current): {current_time*1e6:.4f} us per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = optimized_last_ema(values, period)
    end = time.perf_counter()
    opt_time = (end - start) / iterations
    print(f"last_ema (optimized): {opt_time*1e6:.4f} us per call")

    print(f"Improvement: {(current_time - opt_time) / current_time * 100:.2f}%")

if __name__ == "__main__":
    benchmark()
