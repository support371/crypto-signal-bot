"""Unit tests for the indicator library."""
import math
import pytest
from backend.logic.indicators import (
    ema, last_ema,
    rsi, last_rsi,
    macd, last_macd,
    bollinger_bands, last_bollinger,
    atr, last_atr,
)

# ── helpers ──────────────────────────────────────────────────────────────────
def _prices(n: int, start: float = 100.0, step: float = 1.0):
    return [start + i * step for i in range(n)]

def _notnone(lst):
    return [v for v in lst if v is not None]


# ── EMA ───────────────────────────────────────────────────────────────────────
class TestEMA:
    def test_length_matches_input(self):
        prices = _prices(50)
        result = ema(prices, 20)
        assert len(result) == 50

    def test_leading_none(self):
        result = ema(_prices(30), 20)
        assert all(v is None for v in result[:19])
        assert result[19] is not None

    def test_seed_equals_sma(self):
        prices = _prices(20)
        result = ema(prices, 20)
        sma = sum(prices) / 20
        assert abs(result[19] - sma) < 1e-9

    def test_uptrend_ema_rises(self):
        prices = _prices(50, step=2.0)
        result = _notnone(ema(prices, 10))
        assert result[-1] > result[0]

    def test_insufficient_data_all_none(self):
        assert all(v is None for v in ema(_prices(5), 20))

    def test_last_ema_returns_float(self):
        assert isinstance(last_ema(_prices(50), 20), float)

    def test_last_ema_none_on_short(self):
        assert last_ema(_prices(5), 20) is None


# ── RSI ───────────────────────────────────────────────────────────────────────
class TestRSI:
    def test_length_matches(self):
        assert len(rsi(_prices(30), 14)) == 30

    def test_rising_series_high_rsi(self):
        prices = _prices(30, step=1.0)
        r = last_rsi(prices, 14)
        assert r is not None and r > 70

    def test_falling_series_low_rsi(self):
        prices = _prices(30, step=-1.0)
        r = last_rsi(prices, 14)
        assert r is not None and r < 30

    def test_flat_series_rsi_50(self):
        prices = [100.0] * 30
        r = last_rsi(prices, 14)
        assert r is not None

    def test_bounds(self):
        for v in _notnone(rsi(_prices(50, step=0.5), 14)):
            assert 0 <= v <= 100

    def test_none_on_insufficient_data(self):
        assert last_rsi(_prices(5), 14) is None


# ── MACD ──────────────────────────────────────────────────────────────────────
class TestMACD:
    def test_returns_three_lists(self):
        ml, sl, hist = macd(_prices(60))
        assert len(ml) == len(sl) == len(hist) == 60

    def test_macd_nonnone_after_slow_period(self):
        prices = _prices(60)
        ml, _, _ = macd(prices, 12, 26, 9)
        nonnone = [v for v in ml if v is not None]
        assert len(nonnone) > 0

    def test_histogram_macd_minus_signal(self):
        prices = _prices(60, step=0.5)
        ml, sl, hist = macd(prices)
        for m, s, h in zip(ml, sl, hist):
            if m is not None and s is not None and h is not None:
                assert abs((m - s) - h) < 1e-9

    def test_last_macd_tuple(self):
        # last_macd returns a single Tuple by default
        ml, sl, hist = last_macd(_prices(60))
        assert all(v is not None for v in [ml, sl, hist])

    def test_last_macd_none_on_short(self):
        ml, sl, hist = last_macd(_prices(10))
        assert ml is None

    def test_last_macd_multiple_count(self):
        res = last_macd(_prices(60), count=2)
        assert len(res) == 2
        # current
        ml1, sl1, hist1 = res[1]
        # previous
        ml0, sl0, hist0 = res[0]
        assert ml1 is not None and ml0 is not None


# ── Bollinger Bands ───────────────────────────────────────────────────────────
class TestBollingerBands:
    def test_returns_three_lists(self):
        u, m, l = bollinger_bands(_prices(30))
        assert len(u) == len(m) == len(l) == 30

    def test_upper_gt_mid_gt_lower(self):
        u, m, l = bollinger_bands(_prices(30, step=0.1))
        for uv, mv, lv in zip(u, m, l):
            if uv is not None:
                assert uv >= mv >= lv

    def test_flat_series_zero_band(self):
        prices = [100.0] * 25
        u, m, l = bollinger_bands(prices, 20)
        last_u = next(v for v in reversed(u) if v is not None)
        last_l = next(v for v in reversed(l) if v is not None)
        assert abs(last_u - last_l) < 1e-6

    def test_last_bollinger_none_on_short(self):
        u, m, l = last_bollinger(_prices(5), 20)
        assert u is None

    def test_last_bollinger_returns_values(self):
        u, m, l = last_bollinger(_prices(30))
        assert all(v is not None for v in [u, m, l])


# ── ATR ───────────────────────────────────────────────────────────────────────
class TestATR:
    def _ohlc(self, n):
        closes = _prices(n, step=1.0)
        highs  = [c + 2.0 for c in closes]
        lows   = [c - 2.0 for c in closes]
        return highs, lows, closes

    def test_length_matches(self):
        h, l, c = self._ohlc(30)
        assert len(atr(h, l, c, 14)) == 30

    def test_atr_positive(self):
        h, l, c = self._ohlc(30)
        v = last_atr(h, l, c, 14)
        assert v is not None and v > 0

    def test_none_on_insufficient(self):
        h, l, c = self._ohlc(5)
        assert last_atr(h, l, c, 14) is None

    def test_wider_range_larger_atr(self):
        n = 30
        closes = _prices(n)
        h_narrow = [c + 1 for c in closes]
        l_narrow = [c - 1 for c in closes]
        h_wide   = [c + 5 for c in closes]
        l_wide   = [c - 5 for c in closes]
        atr_narrow = last_atr(h_narrow, l_narrow, closes, 14)
        atr_wide   = last_atr(h_wide,   l_wide,   closes, 14)
        assert atr_wide > atr_narrow
