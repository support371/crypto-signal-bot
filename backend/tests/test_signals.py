"""Tests for the signal engine."""

from backend.models_core import Features
from backend.logic.signals import classify_regime, build_signal


def _make_features(**kwargs) -> Features:
    defaults = dict(
        spread_pct=0.02,
        imbalance=0.0,
        mid_vel=0.0,
        depth_decay=0.0,
        vol_spike=False,
        short_reversal=False,
    )
    defaults.update(kwargs)
    return Features(**defaults)


class TestClassifyRegime:
    def test_vol_spike_is_chaos(self):
        assert classify_regime(_make_features(vol_spike=True)) == "CHAOS"

    def test_wide_spread_is_chaos(self):
        assert classify_regime(_make_features(spread_pct=0.09)) == "CHAOS"

    def test_high_velocity_is_trend(self):
        assert classify_regime(_make_features(mid_vel=0.01)) == "TREND"

    def test_negative_velocity_is_trend(self):
        assert classify_regime(_make_features(mid_vel=-0.006)) == "TREND"

    def test_calm_market_is_range(self):
        assert classify_regime(_make_features(mid_vel=0.001)) == "RANGE"


class TestBuildSignal:
    def test_trend_up(self):
        sig = build_signal(_make_features(mid_vel=0.01, imbalance=0.3))
        assert sig.direction == "UP"
        assert sig.regime == "TREND"
        assert sig.confidence == 0.65

    def test_trend_down(self):
        sig = build_signal(_make_features(mid_vel=-0.01, imbalance=-0.3))
        assert sig.direction == "DOWN"
        assert sig.regime == "TREND"

    def test_chaos_neutral(self):
        sig = build_signal(_make_features(vol_spike=True))
        assert sig.direction == "NEUTRAL"
        assert sig.regime == "CHAOS"
        assert sig.confidence == 0.30

    def test_range_reversal_down(self):
        sig = build_signal(_make_features(
            mid_vel=0.002, short_reversal=True, depth_decay=0.0
        ))
        assert sig.direction == "DOWN"
        assert sig.regime == "RANGE"

    def test_range_reversal_up(self):
        sig = build_signal(_make_features(
            mid_vel=-0.002, short_reversal=True, depth_decay=0.0
        ))
        assert sig.direction == "UP"
        assert sig.regime == "RANGE"

    def test_meta_contains_features(self):
        sig = build_signal(_make_features(spread_pct=0.03))
        assert "spread_pct" in sig.meta
        assert sig.meta["spread_pct"] == 0.03
