
import time
import random

def current_last_bollinger(values, period=20, num_std=2.0):
    n = len(values)
    if n < period or period <= 0:
        return None, None, None
    window = values[-period:]
    sma = sum(window) / period
    variance = sum((x - sma) ** 2 for x in window) / period
    std = max(variance, 0.0) ** 0.5
    return sma + num_std * std, sma, sma - num_std * std

def optimized_last_bollinger(values, period=20, num_std=2.0):
    n = len(values)
    if n < period or period <= 0:
        return None, None, None

    # Use a slice for the window to leverage C-optimized sum()
    window = values[-period:]
    current_sum = sum(window)
    inv_period = 1.0 / period
    sma = current_sum * inv_period

    # One-pass variance calculation: E[X^2] - (E[X])^2
    # But wait, .jules/bolt.md says:
    # "stable two-pass variance calculation is preferred over naive one-pass to avoid numerical instability"
    # "explicit Python loops for summing are generally slower than C-implemented built-ins like sum() on a slice"

    # So we keep two-pass but optimize it.
    # The current two-pass is:
    # variance = sum((x - sma) ** 2 for x in window) / period

    # Let's try to make it faster without losing stability.
    # sum((x - sma) ** 2 for x in window) involves a generator expression.

    # Alternative:
    # sq_diff_sum = 0.0
    # for x in window:
    #     diff = x - sma
    #     sq_diff_sum += diff * diff
    # variance = sq_diff_sum * inv_period

    sq_diff_sum = 0.0
    for x in window:
        diff = x - sma
        sq_diff_sum += diff * diff
    variance = sq_diff_sum * inv_period
    std = max(variance, 0.0) ** 0.5

    return sma + num_std * std, sma, sma - num_std * std

def benchmark():
    n = 1000
    period = 20
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking last_bollinger with N={n}, period={period}")

    # Warmup
    for _ in range(100):
        _ = current_last_bollinger(values, period)
        _ = optimized_last_bollinger(values, period)

    iterations = 200000

    start = time.perf_counter()
    for _ in range(iterations):
        _ = current_last_bollinger(values, period)
    end = time.perf_counter()
    current_time = (end - start) / iterations
    print(f"last_bollinger (current): {current_time*1e6:.4f} us per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = optimized_last_bollinger(values, period)
    end = time.perf_counter()
    opt_time = (end - start) / iterations
    print(f"last_bollinger (optimized): {opt_time*1e6:.4f} us per call")

    print(f"Improvement: {(current_time - opt_time) / current_time * 100:.2f}%")

if __name__ == "__main__":
    benchmark()
