"""Tests for the risk engine."""

from backend.models_core import Features, Signal
from backend.logic.risk import compute_risk_score, risk_gate


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


class TestComputeRiskScore:
    def test_calm_market_low_risk(self):
        feats = _make_features(spread_pct=0.01, mid_vel=0.001)
        score = compute_risk_score(feats)
        assert 0 <= score <= 30

    def test_wide_spread_high_risk(self):
        feats = _make_features(spread_pct=0.10)
        score = compute_risk_score(feats)
        assert score >= 25

    def test_vol_spike_adds_25(self):
        calm = compute_risk_score(_make_features())
        spike = compute_risk_score(_make_features(vol_spike=True))
        assert spike - calm == 25.0

    def test_depth_decay_increases_risk(self):
        no_decay = compute_risk_score(_make_features(depth_decay=0.0))
        decay = compute_risk_score(_make_features(depth_decay=-0.20))
        assert decay > no_decay

    def test_score_capped_at_100(self):
        feats = _make_features(
            spread_pct=1.0, mid_vel=0.5, depth_decay=-1.0, vol_spike=True
        )
        score = compute_risk_score(feats)
        assert score == 100.0

    def test_score_minimum_zero(self):
        feats = _make_features()
        score = compute_risk_score(feats)
        assert score >= 0.0


class TestRiskGate:
    def test_high_risk_produces_hold(self):
        signal = Signal(
            direction="UP", confidence=0.7, regime="TREND",
            horizon_minutes=15, meta={},
        )
        decision = risk_gate(signal, 80.0)
        assert decision.intent == "HOLD"
        assert decision.approved is False

    def test_chaos_regime_produces_hold(self):
        signal = Signal(
            direction="UP", confidence=0.7, regime="CHAOS",
            horizon_minutes=15, meta={},
        )
        decision = risk_gate(signal, 20.0)
        assert decision.intent == "HOLD"
        assert decision.approved is False

    def test_neutral_signal_hold(self):
        signal = Signal(
            direction="NEUTRAL", confidence=0.5, regime="RANGE",
            horizon_minutes=15, meta={},
        )
        decision = risk_gate(signal, 20.0)
        assert decision.intent == "HOLD"

    def test_up_signal_enters_long(self):
        signal = Signal(
            direction="UP", confidence=0.7, regime="TREND",
            horizon_minutes=15, meta={},
        )
        decision = risk_gate(signal, 30.0)
        assert decision.intent == "ENTER_LONG"
        assert decision.approved is True
        assert decision.size_fraction > 0

    def test_down_signal_exits(self):
        signal = Signal(
            direction="DOWN", confidence=0.65, regime="TREND",
            horizon_minutes=15, meta={},
        )
        decision = risk_gate(signal, 30.0)
        assert decision.intent == "EXIT"
        assert decision.approved is True

    def test_higher_risk_reduces_size(self):
        signal = Signal(
            direction="UP", confidence=0.7, regime="TREND",
            horizon_minutes=15, meta={},
        )
        low_risk = risk_gate(signal, 20.0)
        high_risk = risk_gate(signal, 60.0)
        assert low_risk.size_fraction > high_risk.size_fraction
