
import time
import random
from backend.logic.indicators import rsi, atr

def benchmark():
    n = 100000
    period = 14
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    print(f"Benchmarking series indicators with N={n}, period={period}")

    # Benchmark RSI
    start = time.perf_counter()
    for _ in range(10):
        _ = rsi(closes, period)
    end = time.perf_counter()
    print(f"RSI (current): {(end - start) / 10:.4f}s per call")

    # Benchmark ATR
    start = time.perf_counter()
    for _ in range(10):
        _ = atr(highs, lows, closes, period)
    end = time.perf_counter()
    print(f"ATR (current): {(end - start) / 10:.4f}s per call")

if __name__ == "__main__":
    benchmark()
