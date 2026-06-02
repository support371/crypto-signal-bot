import time
import random
import uuid
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field

# Mocking parts of signal_engine to focus on indicator overhead
# or just import evaluate_symbol if dependencies are met.
from backend.logic.signal_engine import evaluate_symbol
from backend.logic.indicators import (
    last_atr, last_bollinger, last_ema, last_macd, last_rsi,
    macd as macd_series
)

def benchmark_evaluate_symbol():
    print("--- Benchmarking evaluate_symbol ---")
    # 500 candles is a typical amount for 1h or 1d history
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

def benchmark_individual_indicators():
    print("\n--- Benchmarking Individual Indicator Calls (as done in signal_engine) ---")
    n = 500
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    iterations = 500

    # 1. ATR
    start = time.time()
    for _ in range(iterations):
        last_atr(highs, lows, closes, 14)
    print(f"last_atr: {time.time() - start:.4f}s")

    # 2. EMAs (20, 50, 200)
    start = time.time()
    for _ in range(iterations):
        last_ema(closes, 20)
        last_ema(closes, 50)
        last_ema(closes, 200)
    print(f"last_ema (3 calls): {time.time() - start:.4f}s")

    # 3. RSI
    start = time.time()
    for _ in range(iterations):
        last_rsi(closes, 14)
    print(f"last_rsi: {time.time() - start:.4f}s")

    # 4. Bollinger
    start = time.time()
    for _ in range(iterations):
        last_bollinger(closes, 20, 2.0)
    print(f"last_bollinger: {time.time() - start:.4f}s")

    # 5. MACD (Current)
    start = time.time()
    for _ in range(iterations):
        last_macd(closes, 12, 26, 9)
    print(f"last_macd: {time.time() - start:.4f}s")

    # 6. MACD (Previous via series)
    start = time.time()
    for _ in range(iterations):
        ml_series, sl_series, _ = macd_series(closes, 12, 26, 9)
        # simulating the extraction in signal_engine
        prev_macd_vals  = [v for v in ml_series if v is not None]
        prev_sig_vals   = [v for v in sl_series  if v is not None]
        _ = prev_macd_vals[-2] if len(prev_macd_vals) >= 2 else None
        _ = prev_sig_vals[-2]  if len(prev_sig_vals)  >= 2 else None
    print(f"macd_series + processing (for prev bar): {time.time() - start:.4f}s")

if __name__ == "__main__":
    benchmark_evaluate_symbol()
    benchmark_individual_indicators()
