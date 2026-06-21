import timeit
import random
from backend.logic.indicators import last_ema, last_rsi, last_atr, last_bollinger, bollinger_bands, last_macd

def benchmark():
    n = 1000
    period = 14
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    print(f"Benchmarking indicators with N={n}, period={period}")

    # last_ema
    t = timeit.timeit(lambda: last_ema(closes, 20), number=1000)
    print(f"last_ema:       {t:.4f}s per 1000 calls")

    # last_rsi
    t = timeit.timeit(lambda: last_rsi(closes, 14), number=1000)
    print(f"last_rsi:       {t:.4f}s per 1000 calls")

    # last_atr
    t = timeit.timeit(lambda: last_atr(highs, lows, closes, 14), number=1000)
    print(f"last_atr:       {t:.4f}s per 1000 calls")

    # last_bollinger
    t = timeit.timeit(lambda: last_bollinger(closes, 20), number=1000)
    print(f"last_bollinger: {t:.4f}s per 1000 calls")

    # bollinger_bands (series)
    t = timeit.timeit(lambda: bollinger_bands(closes, 20), number=100)
    print(f"bollinger_bands:{t:.4f}s per 100 calls")

    # last_macd (count=2)
    t = timeit.timeit(lambda: last_macd(closes, 12, 26, 9, count=2), number=1000)
    print(f"last_macd(c=2): {t:.4f}s per 1000 calls")

if __name__ == "__main__":
    benchmark()
