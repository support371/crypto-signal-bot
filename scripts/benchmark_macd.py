
import time
import random
from backend.logic.indicators import macd

def benchmark():
    n = 100000
    fast, slow, signal = 12, 26, 9
    closes = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking MACD series with N={n}")

    # Warmup
    _ = macd(closes, fast, slow, signal)

    start = time.perf_counter()
    for _ in range(20):
        _ = macd(closes, fast, slow, signal)
    end = time.perf_counter()

    avg_time = (end - start) / 20
    print(f"MACD (current): {avg_time:.4f}s per call")

if __name__ == "__main__":
    benchmark()
