
import math
from backend.logic.indicators import rsi as rsi_opt, atr as atr_opt

def rsi_orig(values, period=14):
    if len(values) < period + 1:
        return [None] * len(values)
    result = [None] * len(values)
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(c, 0.0) for c in changes]
    losses = [abs(min(c, 0.0)) for c in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    seed_idx = period
    if avg_loss == 0:
        result[seed_idx] = 100.0
    else:
        rs = avg_gain / avg_loss
        result[seed_idx] = 100.0 - (100.0 / (1 + rs))
    for i in range(period + 1, len(values)):
        ci = i - 1
        avg_gain = (avg_gain * (period - 1) + gains[ci]) / period
        avg_loss = (avg_loss * (period - 1) + losses[ci]) / period
        if avg_loss == 0:
            result[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[i] = 100.0 - (100.0 / (1 + rs))
    return result

def atr_orig(highs, lows, closes, period=14):
    n = len(closes)
    if len(highs) != n or len(lows) != n:
        raise ValueError("highs, lows, closes must be same length")
    if n < 2:
        return [None] * n
    tr_list = []
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr_list.append(max(hl, hpc, lpc))
    result = [None] * n
    if len(tr_list) < period:
        return result
    seed = sum(tr_list[:period]) / period
    result[period] = seed
    prev = seed
    for i in range(period + 1, n):
        ti = i - 1
        val = (prev * (period - 1) + tr_list[ti]) / period
        result[i] = val
        prev = val
    return result

def verify():
    import random
    n = 1000
    period = 14
    closes = [random.uniform(100, 200) for _ in range(n)]
    highs = [c + random.uniform(0, 5) for c in closes]
    lows = [c - random.uniform(0, 5) for c in closes]

    # Verify RSI
    orig_rsi = rsi_orig(closes, period)
    opt_rsi = rsi_opt(closes, period)
    for i in range(n):
        if orig_rsi[i] is None:
            assert opt_rsi[i] is None
        else:
            assert abs(orig_rsi[i] - opt_rsi[i]) < 1e-9, f"RSI mismatch at index {i}: {orig_rsi[i]} != {opt_rsi[i]}"
    print("RSI verification passed!")

    # Verify ATR
    orig_atr = atr_orig(highs, lows, closes, period)
    opt_atr = atr_opt(highs, lows, closes, period)
    for i in range(n):
        if orig_atr[i] is None:
            assert opt_atr[i] is None
        else:
            assert abs(orig_atr[i] - opt_atr[i]) < 1e-9, f"ATR mismatch at index {i}: {orig_atr[i]} != {opt_atr[i]}"
    print("ATR verification passed!")

if __name__ == "__main__":
    verify()
