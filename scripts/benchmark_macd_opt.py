
import time
import random
import sys
import os

# Add the project root to sys.path
sys.path.append(os.getcwd())

from backend.logic.indicators import last_macd

def benchmark():
    # Use a realistic number of candles for a signal engine (e.g., 500-1000)
    # and many symbols (e.g. 100) to simulate load.
    N = 1000
    ITERATIONS = 500
    values = [random.uniform(100, 200) for _ in range(N)]

    # Warm up
    last_macd(values, 12, 26, 9, count=2)

    start = time.perf_counter()
    for _ in range(ITERATIONS):
        last_macd(values, 12, 26, 9, count=2)
    end = time.perf_counter()

    elapsed = end - start
    print(f"Benchmark: last_macd(count=2) with N={N}, {ITERATIONS} iterations")
    print(f"Total time: {elapsed:.4f}s")
    print(f"Average time per call: {elapsed/ITERATIONS*1000:.4f}ms")

if __name__ == "__main__":
    benchmark()
