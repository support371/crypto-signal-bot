"""Parity checks for iterator-based last-value indicator paths."""

import math

from backend.logic.indicators import atr, ema, last_atr, last_ema, last_rsi, rsi


def _assert_optional_close(actual, expected):
    if expected is None:
        assert actual is None
    else:
        assert actual is not None
        assert math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12)


def test_last_ema_matches_full_series_tail():
    values = [100.0 + index * 0.75 + ((index % 5) - 2) * 0.2 for index in range(250)]

    _assert_optional_close(last_ema(values, 21), ema(values, 21)[-1])


def test_last_rsi_matches_full_series_tail():
    values = [100.0 + math.sin(index / 5.0) * 4.0 + index * 0.03 for index in range(300)]

    _assert_optional_close(last_rsi(values, 14), rsi(values, 14)[-1])


def test_last_atr_matches_full_series_tail():
    closes = [200.0 + math.sin(index / 7.0) * 3.0 + index * 0.04 for index in range(300)]
    highs = [close + 1.0 + (index % 3) * 0.1 for index, close in enumerate(closes)]
    lows = [close - 0.8 - (index % 4) * 0.1 for index, close in enumerate(closes)]

    _assert_optional_close(last_atr(highs, lows, closes, 14), atr(highs, lows, closes, 14)[-1])


def test_iterator_paths_preserve_insufficient_data_behavior():
    values = [1.0, 2.0, 3.0]

    assert last_ema(values, 5) is None
    assert last_rsi(values, 5) is None
    assert last_atr(values, values, values, 5) is None
