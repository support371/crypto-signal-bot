
import time
import random
import itertools
from typing import List, Optional

def current_last_ema(values: List[float], period: int) -> Optional[float]:
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for i in range(period, len(values)):
        val += k * (values[i] - val)
    return val

def islice_last_ema(values: List[float], period: int) -> Optional[float]:
    if len(values) < period or period <= 0:
        return None
    k = 2.0 / (period + 1)
    val = sum(values[:period]) / period
    for v in itertools.islice(values, period, None):
        val += k * (v - val)
    return val

def benchmark():
    n = 100000
    period = 200
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking last_ema with N={n}, period={period}")

    # Warmup
    for _ in range(10):
        _ = current_last_ema(values, period)
        _ = islice_last_ema(values, period)

    iterations = 100

    start = time.perf_counter()
    for _ in range(iterations):
        _ = current_last_ema(values, period)
    end = time.perf_counter()
    current_time = (end - start) / iterations
    print(f"last_ema (current): {current_time:.6f} s per call")

    start = time.perf_counter()
    for _ in range(iterations):
        _ = islice_last_ema(values, period)
    end = time.perf_counter()
    islice_time = (end - start) / iterations
    print(f"last_ema (islice): {islice_time:.6f} s per call")

    print(f"Improvement: {(current_time - islice_time) / current_time * 100:.2f}%")

if __name__ == "__main__":
    benchmark()
