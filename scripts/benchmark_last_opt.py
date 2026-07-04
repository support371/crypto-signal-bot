
import time
import random
import itertools
from backend.logic.indicators import last_ema, last_rsi, last_atr

def benchmark():
    print("Benchmarking optimized 'last' indicators...")
    n = 1000
    period = 14
    iters = 100000

    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    # EMA
    start = time.perf_counter()
    for _ in range(iters):
        last_ema(closes, period)
    t_ema = time.perf_counter() - start
    print(f"last_ema: {t_ema:.4f}s for {iters} calls")

    # RSI
    start = time.perf_counter()
    for _ in range(iters):
        last_rsi(closes, period)
    t_rsi = time.perf_counter() - start
    print(f"last_rsi: {t_rsi:.4f}s for {iters} calls")

    # ATR
    start = time.perf_counter()
    for _ in range(iters):
        last_atr(highs, lows, closes, period)
    t_atr = time.perf_counter() - start
    print(f"last_atr: {t_atr:.4f}s for {iters} calls")

if __name__ == "__main__":
    benchmark()
