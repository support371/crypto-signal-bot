"""
Comprehensive tests for optimized RSI and ATR series calculations.

Verifies:
1. Optimized functions produce identical output to original implementations
2. Performance characteristics match expected behavior
3. Edge cases are handled correctly
4. Backward compatibility is maintained
"""
import math
import random
from typing import List, Optional

import pytest

from backend.logic.indicators import (
    rsi, last_rsi,
    atr, last_atr,
)


# ────────────────────────────────────────────────────────────────────────────
# Test Utilities & Fixtures
# ────────────────────────────────────────────────────────────────────────────

def _prices(n: int, start: float = 100.0, step: float = 1.0) -> List[float]:
    """Generate a deterministic price series."""
    return [start + i * step for i in range(n)]


def _ohlc(n: int, start: float = 100.0, step: float = 1.0, volatility: float = 2.0):
    """Generate OHLCV data for testing."""
    closes = _prices(n, start, step)
    highs = [c + abs(random.uniform(0, volatility)) for c in closes]
    lows = [c - abs(random.uniform(0, volatility)) for c in closes]
    # Ensure high >= close >= low
    for i in range(len(closes)):
        if highs[i] < closes[i]:
            highs[i] = closes[i]
        if lows[i] > closes[i]:
            lows[i] = closes[i]
    return closes, highs, lows


# ────────────────────────────────────────────────────────────────────────────
# Reference Implementations (for verification)
# ────────────────────────────────────────────────────────────────────────────

def _rsi_reference(values: List[float], period: int = 14) -> List[Optional[float]]:
    """Reference RSI implementation (before optimization)."""
    if len(values) < period + 1:
        return [None] * len(values)

    result: List[Optional[float]] = [None] * len(values)
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


def _atr_reference(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[Optional[float]]:
    """Reference ATR implementation (before optimization)."""
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

    result: List[Optional[float]] = [None] * n
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


# ────────────────────────────────────────────────────────────────────────────
# RSI Optimization Tests
# ────────────────────────────────────────────────────────────────────────────

class TestRSIOptimization:
    """Verify RSI optimization correctness and edge cases."""

    def test_rsi_matches_reference_uptrend(self):
        """Optimized RSI should match reference on sustained uptrend."""
        prices = _prices(100, step=1.5)
        expected = _rsi_reference(prices, 14)
        actual = rsi(prices, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None, f"Index {i}: expected None, got {act}"
            else:
                assert abs(exp - act) < 1e-9, f"Index {i}: {exp} != {act}"

    def test_rsi_matches_reference_downtrend(self):
        """Optimized RSI should match reference on sustained downtrend."""
        prices = _prices(100, step=-0.8)
        expected = _rsi_reference(prices, 14)
        actual = rsi(prices, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None
            else:
                assert abs(exp - act) < 1e-9

    def test_rsi_matches_reference_random_prices(self):
        """Optimized RSI should match reference on random price data."""
        random.seed(42)
        prices = [100.0 + random.uniform(-5, 5) for _ in range(200)]
        expected = _rsi_reference(prices, 14)
        actual = rsi(prices, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None
            else:
                assert abs(exp - act) < 1e-9, f"Mismatch at index {i}: {exp} vs {act}"

    def test_rsi_bounds_0_to_100(self):
        """RSI values should always be between 0 and 100."""
        random.seed(43)
        prices = [100.0 + random.uniform(-20, 20) for _ in range(500)]
        result = rsi(prices, 14)

        for val in result:
            if val is not None:
                assert 0 <= val <= 100, f"RSI out of bounds: {val}"

    def test_rsi_high_on_strong_uptrend(self):
        """RSI should be > 70 on strong sustained uptrend."""
        prices = _prices(50, step=2.0)
        result = rsi(prices, 14)
        last_rsi_val = next(v for v in reversed(result) if v is not None)
        assert last_rsi_val > 70, f"Expected RSI > 70, got {last_rsi_val}"

    def test_rsi_low_on_strong_downtrend(self):
        """RSI should be < 30 on strong sustained downtrend."""
        prices = _prices(50, step=-2.0)
        result = rsi(prices, 14)
        last_rsi_val = next(v for v in reversed(result) if v is not None)
        assert last_rsi_val < 30, f"Expected RSI < 30, got {last_rsi_val}"

    def test_rsi_flat_series_around_50(self):
        """RSI should be around 50 on flat price series."""
        prices = [100.0] * 100
        result = rsi(prices, 14)
        # Last value should be ~50 (RSI = 50 when gains = losses)
        last_rsi_val = next(v for v in reversed(result) if v is not None)
        assert 45 < last_rsi_val < 55, f"Expected RSI ~50, got {last_rsi_val}"

    def test_last_rsi_matches_series_last_value(self):
        """last_rsi() should return the same value as the last non-None in rsi()."""
        random.seed(44)
        prices = [100.0 + random.uniform(-10, 10) for _ in range(150)]

        series = rsi(prices, 14)
        last_from_series = next((v for v in reversed(series) if v is not None), None)
        last_from_fn = last_rsi(prices, 14)

        if last_from_series is not None:
            assert abs(last_from_series - last_from_fn) < 1e-9

    def test_rsi_insufficient_data_returns_none(self):
        """RSI should return all None when insufficient data."""
        result = rsi(_prices(10), 14)
        assert all(v is None for v in result)

    def test_last_rsi_insufficient_data_returns_none(self):
        """last_rsi should return None when insufficient data."""
        result = last_rsi(_prices(10), 14)
        assert result is None

    def test_rsi_custom_period(self):
        """RSI with custom period should match reference."""
        prices = _prices(100, step=0.5)
        for period in [7, 14, 21]:
            expected = _rsi_reference(prices, period)
            actual = rsi(prices, period)

            for i, (exp, act) in enumerate(zip(expected, actual)):
                if exp is None:
                    assert act is None
                else:
                    assert abs(exp - act) < 1e-9, f"Period {period}, index {i}: {exp} != {act}"


# ────────────────────────────────────────────────────────────────────────────
# ATR Optimization Tests
# ────────────────────────────────────────────────────────────────────────────

class TestATROptimization:
    """Verify ATR optimization correctness and edge cases."""

    def test_atr_matches_reference_normal_data(self):
        """Optimized ATR should match reference on normal OHLC data."""
        random.seed(50)
        closes, highs, lows = _ohlc(100, volatility=3.0)
        expected = _atr_reference(highs, lows, closes, 14)
        actual = atr(highs, lows, closes, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None
            else:
                assert abs(exp - act) < 1e-9, f"Index {i}: {exp} != {act}"

    def test_atr_matches_reference_high_volatility(self):
        """Optimized ATR should match reference on high-volatility data."""
        random.seed(51)
        closes, highs, lows = _ohlc(150, volatility=10.0)
        expected = _atr_reference(highs, lows, closes, 14)
        actual = atr(highs, lows, closes, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None
            else:
                assert abs(exp - act) < 1e-9

    def test_atr_matches_reference_low_volatility(self):
        """Optimized ATR should match reference on low-volatility data."""
        random.seed(52)
        closes, highs, lows = _ohlc(150, volatility=0.5)
        expected = _atr_reference(highs, lows, closes, 14)
        actual = atr(highs, lows, closes, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None
            else:
                assert abs(exp - act) < 1e-9

    def test_atr_always_positive(self):
        """ATR should always be positive."""
        random.seed(53)
        closes, highs, lows = _ohlc(200, volatility=5.0)
        result = atr(highs, lows, closes, 14)

        for val in result:
            if val is not None:
                assert val >= 0, f"ATR should not be negative: {val}"

    def test_atr_increases_with_higher_volatility(self):
        """ATR should be higher on more volatile data."""
        random.seed(54)

        # Low volatility
        closes_low, highs_low, lows_low = _ohlc(200, volatility=1.0)
        atr_low = last_atr(highs_low, lows_low, closes_low, 14)

        # High volatility
        closes_high, highs_high, lows_high = _ohlc(200, volatility=10.0)
        atr_high = last_atr(highs_high, lows_high, closes_high, 14)

        assert atr_high > atr_low, f"High vol ATR ({atr_high}) should exceed low vol ATR ({atr_low})"

    def test_last_atr_matches_series_last_value(self):
        """last_atr() should return the same value as the last non-None in atr()."""
        random.seed(55)
        closes, highs, lows = _ohlc(150, volatility=3.0)

        series = atr(highs, lows, closes, 14)
        last_from_series = next((v for v in reversed(series) if v is not None), None)
        last_from_fn = last_atr(highs, lows, closes, 14)

        if last_from_series is not None:
            assert abs(last_from_series - last_from_fn) < 1e-9

    def test_atr_insufficient_data_returns_none(self):
        """ATR should return all None when insufficient data."""
        closes, highs, lows = _ohlc(10)
        result = atr(highs, lows, closes, 14)
        assert all(v is None for v in result)

    def test_last_atr_insufficient_data_returns_none(self):
        """last_atr should return None when insufficient data."""
        closes, highs, lows = _ohlc(10)
        result = last_atr(highs, lows, closes, 14)
        assert result is None

    def test_atr_custom_period(self):
        """ATR with custom period should match reference."""
        random.seed(56)
        closes, highs, lows = _ohlc(200, volatility=3.0)

        for period in [7, 14, 21]:
            expected = _atr_reference(highs, lows, closes, period)
            actual = atr(highs, lows, closes, period)

            for i, (exp, act) in enumerate(zip(expected, actual)):
                if exp is None:
                    assert act is None
                else:
                    assert abs(exp - act) < 1e-9, f"Period {period}, index {i}: {exp} != {act}"

    def test_atr_mismatched_lengths_raises(self):
        """ATR should raise on mismatched input lengths."""
        closes = _prices(50)
        highs = _prices(51)
        lows = _prices(50)

        with pytest.raises(ValueError):
            atr(highs, lows, closes, 14)

    def test_atr_realistic_price_gaps(self):
        """ATR should correctly handle price gaps and gaps up/down from close."""
        # Simulate gap-up open followed by decline
        closes = [100.0, 105.0, 104.0, 106.0, 103.0] * 20
        highs = [c + 5.0 for c in closes]
        lows = [c - 2.0 for c in closes]

        expected = _atr_reference(highs, lows, closes, 14)
        actual = atr(highs, lows, closes, 14)

        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp is None:
                assert act is None
            else:
                assert abs(exp - act) < 1e-9


# ────────────────────────────────────────────────────────────────────────────
# Integration Tests
# ────────────────────────────────────────────────────────────────────────────

class TestOptimizationIntegration:
    """Integration tests for optimized indicators."""

    def test_both_indicators_on_same_data(self):
        """RSI and ATR should both work correctly on the same price series."""
        random.seed(60)
        closes = [100.0 + random.uniform(-5, 5) for _ in range(300)]
        highs = [c + abs(random.uniform(0, 3)) for c in closes]
        lows = [c - abs(random.uniform(0, 3)) for c in closes]

        # Should not raise
        rsi_vals = rsi(closes, 14)
        atr_vals = atr(highs, lows, closes, 14)

        # Both should have some non-None values
        rsi_nonnone = [v for v in rsi_vals if v is not None]
        atr_nonnone = [v for v in atr_vals if v is not None]

        assert len(rsi_nonnone) > 0
        assert len(atr_nonnone) > 0

    def test_large_dataset_performance(self):
        """Optimized functions should handle large datasets efficiently."""
        # 100,000 data points
        closes = _prices(100000, step=0.001)
        highs = [c + 0.5 for c in closes]
        lows = [c - 0.5 for c in closes]

        # Should complete without timeout
        rsi_result = last_rsi(closes, 14)
        atr_result = last_atr(highs, lows, closes, 14)

        assert rsi_result is not None
        assert atr_result is not None
        assert 0 <= rsi_result <= 100
        assert atr_result >= 0
