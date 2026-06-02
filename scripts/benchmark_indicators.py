import time
import random
from backend.logic.indicators import last_ema, last_rsi, last_macd, last_bollinger, last_atr

def benchmark():
    # 10,000 data points
    data = [random.uniform(100, 200) for _ in range(10000)]
    highs = [d + random.uniform(0, 5) for d in data]
    lows = [d - random.uniform(0, 5) for d in data]
    closes = data

    iterations = 100

    print(f"Benchmarking with 10,000 data points, {iterations} iterations...")

    # Benchmark EMA
    start = time.time()
    for _ in range(iterations):
        last_ema(closes, 20)
        last_ema(closes, 50)
        last_ema(closes, 200)
    ema_time = time.time() - start
    print(f"last_ema (3 calls): {ema_time:.4f}s")

    # Benchmark RSI
    start = time.time()
    for _ in range(iterations):
        last_rsi(closes, 14)
    rsi_time = time.time() - start
    print(f"last_rsi: {rsi_time:.4f}s")

    # Benchmark Bollinger
    start = time.time()
    for _ in range(iterations):
        last_bollinger(closes, 20)
    bb_time = time.time() - start
    print(f"last_bollinger: {bb_time:.4f}s")

    # Benchmark MACD
    start = time.time()
    for _ in range(iterations):
        last_macd(closes, 12, 26, 9)
    macd_time = time.time() - start
    print(f"last_macd: {macd_time:.4f}s")

    # Benchmark ATR
    start = time.time()
    for _ in range(iterations):
        last_atr(highs, lows, closes, 14)
    atr_time = time.time() - start
    print(f"last_atr: {atr_time:.4f}s")

    total_time = ema_time + rsi_time + bb_time + macd_time + atr_time
    print(f"Total time: {total_time:.4f}s")

if __name__ == "__main__":
    benchmark()
