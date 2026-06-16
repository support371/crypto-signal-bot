
import math
from typing import List, Optional, Tuple
from backend.logic.indicators import (
    ema, last_ema, rsi, last_rsi, macd, last_macd, bollinger_bands, last_bollinger, atr, last_atr
)

def assert_almost_equal(a, b, places=7, msg=""):
    if a is None or b is None:
        assert a == b, f"{msg}: {a} != {b}"
        return
    if isinstance(a, (list, tuple)):
        assert len(a) == len(b), f"{msg}: lengths differ {len(a)} != {len(b)}"
        for i, (va, vb) in enumerate(zip(a, b)):
            assert_almost_equal(va, vb, places, f"{msg} at index {i}")
        return
    assert math.isclose(a, b, rel_tol=10**(-places)), f"{msg}: {a} != {b}"

def test_correctness():
    print("Testing correctness of optimizations...")

    # Generate some test data
    import random
    random.seed(42)
    n = 100
    closes = [100.0 + random.uniform(-5, 5) + i * 0.1 for i in range(n)]
    highs = [c + random.uniform(0, 2) for c in closes]
    lows = [c - random.uniform(0, 2) for c in closes]

    # We will run these tests BEFORE and AFTER changes to ensure they pass.
    # Since I'm optimizing in place, I'll rely on the logic being mathematically equivalent.

    # EMA
    period = 10
    e_series = ema(closes, period)
    e_last = last_ema(closes, period)
    assert_almost_equal(e_series[-1], e_last, msg="EMA last value mismatch")

    # RSI
    r_series = rsi(closes, period)
    r_last = last_rsi(closes, period)
    assert_almost_equal(r_series[-1], r_last, msg="RSI last value mismatch")

    # MACD
    m_l, s_l, hist = macd(closes, 12, 26, 9)
    m_last_val = last_macd(closes, 12, 26, 9, count=1)
    assert_almost_equal((m_l[-1], s_l[-1], hist[-1]), m_last_val, msg="MACD last value mismatch")

    # BB
    upper, mid, lower = bollinger_bands(closes, 20, 2.0)
    l_upper, l_mid, l_lower = last_bollinger(closes, 20, 2.0)
    assert_almost_equal((upper[-1], mid[-1], lower[-1]), (l_upper, l_mid, l_lower), msg="BB last value mismatch")

    # ATR
    a_series = atr(highs, lows, closes, 14)
    a_last = last_atr(highs, lows, closes, 14)
    assert_almost_equal(a_series[-1], a_last, msg="ATR last value mismatch")

    print("Correctness tests passed!")

if __name__ == "__main__":
    test_correctness()
