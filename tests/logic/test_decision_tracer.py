# tests/logic/test_decision_tracer.py
"""
Tests for DecisionTracer — covers BUY, SELL, HOLD, and ring-buffer behaviour.
"""
import pytest
from backend.logic.decision_tracer import DecisionTracer, HoldReason


@pytest.fixture
def tracer():
    t = DecisionTracer(max_entries=10)
    t.flush()
    return t


def _buy_entry(tracer, symbol="BTCUSDT"):
    return tracer.make_entry(
        symbol=symbol, decision="BUY", side="BUY",
        confidence=0.85, strategy_id="trend_v1",
        signal_side="BUY", equity=10000.0, notional=500.0, mode="paper",
    )


def _hold_entry(tracer, symbol="BTCUSDT", code="LOW_CONFIDENCE", conf=0.55):
    return tracer.make_entry(
        symbol=symbol, decision="HOLD", side=None,
        confidence=conf, strategy_id="trend_v1",
        signal_side="BUY", equity=10000.0, notional=500.0, mode="paper",
        hold_reasons=[HoldReason(
            code=code,
            description=f"Test hold reason: {code}",
            threshold=0.75, actual=conf,
        )],
    )


def test_record_buy(tracer):
    tracer.record(_buy_entry(tracer))
    recent = tracer.get_recent(10)
    assert len(recent) == 1
    assert recent[0]["decision"] == "BUY"
    assert recent[0]["symbol"] == "BTCUSDT"


def test_record_hold(tracer):
    tracer.record(_hold_entry(tracer))
    recent = tracer.get_recent(10)
    assert len(recent) == 1
    assert recent[0]["decision"] == "HOLD"
    assert recent[0]["hold_reasons"][0]["code"] == "LOW_CONFIDENCE"


def test_get_hold_traces_filters_correctly(tracer):
    tracer.record(_buy_entry(tracer))
    tracer.record(_hold_entry(tracer))
    tracer.record(_buy_entry(tracer))
    holds = tracer.get_hold_traces()
    assert len(holds) == 1
    assert holds[0]["decision"] == "HOLD"


def test_get_for_symbol(tracer):
    tracer.record(_buy_entry(tracer, "BTCUSDT"))
    tracer.record(_buy_entry(tracer, "ETHUSDT"))
    btc = tracer.get_for_symbol("BTCUSDT")
    assert len(btc) == 1
    assert btc[0]["symbol"] == "BTCUSDT"


def test_stats_empty(tracer):
    s = tracer.get_stats()
    assert s["total"] == 0
    assert s["hold_pct"] == 0.0


def test_stats_with_trades(tracer):
    tracer.record(_buy_entry(tracer))
    tracer.record(_buy_entry(tracer))
    tracer.record(_hold_entry(tracer))
    s = tracer.get_stats()
    assert s["total"] == 3
    assert s["buy"] == 2
    assert s["hold"] == 1
    assert s["hold_pct"] == pytest.approx(33.3, abs=0.1)


def test_hold_reason_breakdown(tracer):
    tracer.record(_hold_entry(tracer, code="LOW_CONFIDENCE"))
    tracer.record(_hold_entry(tracer, code="MAX_POSITIONS_REACHED"))
    tracer.record(_hold_entry(tracer, code="LOW_CONFIDENCE"))
    s = tracer.get_stats()
    assert s["hold_reason_breakdown"]["LOW_CONFIDENCE"] == 2
    assert s["hold_reason_breakdown"]["MAX_POSITIONS_REACHED"] == 1


def test_ring_buffer_bounded(tracer):
    for i in range(15):
        tracer.record(_buy_entry(tracer))
    recent = tracer.get_recent(100)
    assert len(recent) == 10


def test_entry_has_config_thresholds(tracer):
    entry = _buy_entry(tracer)
    d = entry.to_dict()
    assert "min_confidence_threshold" in d
    assert "max_positions" in d
    assert "position_pct" in d
    assert d["min_confidence_threshold"] > 0


def test_newest_first_ordering(tracer):
    tracer.record(_buy_entry(tracer, "BTCUSDT"))
    tracer.record(_buy_entry(tracer, "ETHUSDT"))
    recent = tracer.get_recent(10)
    assert recent[0]["symbol"] == "ETHUSDT"


def test_flush_clears_all(tracer):
    tracer.record(_buy_entry(tracer))
    tracer.record(_hold_entry(tracer))
    tracer.flush()
    assert len(tracer.get_recent(100)) == 0
