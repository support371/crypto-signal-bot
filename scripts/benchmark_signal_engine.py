import time
import random
from backend.logic.signal_engine import evaluate_symbol

def benchmark_evaluate_symbol():
    print("--- Benchmarking evaluate_symbol ---")
    n = 500
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]
    current_price = closes[-1]

    iterations = 500
    start = time.time()
    for _ in range(iterations):
        evaluate_symbol("BTCUSDT", "1h", closes, highs, lows, current_price)

    elapsed = time.time() - start
    print(f"evaluate_symbol (n={n}, {iterations} iterations): {elapsed:.4f}s")
    print(f"Average time per call: {elapsed/iterations*1000:.4f}ms")

if __name__ == "__main__":
    benchmark_evaluate_symbol()
