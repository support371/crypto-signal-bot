
import time
import random
from backend.logic.indicators import last_bollinger

def benchmark():
    n = 1000
    period = 20
    values = [random.uniform(100, 200) for _ in range(n)]

    print(f"Benchmarking last_bollinger with N={n}, period={period}")

    # Warmup
    for _ in range(100):
        _ = last_bollinger(values, period)

    start = time.perf_counter()
    iterations = 100000
    for _ in range(iterations):
        _ = last_bollinger(values, period)
    end = time.perf_counter()

    avg_time = (end - start) / iterations
    print(f"last_bollinger (current): {avg_time*1e6:.4f} us per call")

if __name__ == "__main__":
    benchmark()
