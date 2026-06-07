import sys
import os
import time
import random

import importlib.util
spec = importlib.util.spec_from_file_location("indicators", "backend/logic/indicators.py")
indicators = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indicators)

bollinger_bands = indicators.bollinger_bands

def benchmark_bollinger():
    print("Benchmarking Bollinger Bands...")
    prices = [random.uniform(60000, 70000) for _ in range(10000)]
    period = 20

    # Measure O(N) implementation
    start = time.perf_counter()
    for _ in range(100):
        bollinger_bands(prices, period)
    end = time.perf_counter()
    print(f"bollinger_bands (O(N)): {(end - start):.4f}s")

    # Measure O(N * period) implementation (simulated)
    def bollinger_bands_slow(values, period=20, num_std=2.0):
        n = len(values)
        upper = [None] * n
        middle = [None] * n
        lower = [None] * n
        if n < period: return upper, middle, lower
        for i in range(period - 1, n):
            window = values[i - period + 1 : i + 1]
            sma = sum(window) / period
            variance = sum((x - sma) ** 2 for x in window) / period
            std = variance ** 0.5
            middle[i] = sma
            upper[i] = sma + num_std * std
            lower[i] = sma - num_std * std
        return upper, middle, lower

    start = time.perf_counter()
    for _ in range(100):
        bollinger_bands_slow(prices, period)
    end = time.perf_counter()
    print(f"bollinger_bands (O(N*P)): {(end - start):.4f}s")

if __name__ == "__main__":
    benchmark_bollinger()
