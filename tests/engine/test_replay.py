# tests/engine/test_replay.py
"""
Replay system tests — determinism, signal count, diff utility, API routes.
"""
import math
import time
import pytest
from fastapi.testclient import TestClient

from backend.replay.replayer import Replayer, ReplayCandle, ReplayResult


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_candles(n: int, base_price: float = 60000.0) -> list[ReplayCandle]:
    """Generate synthetic candles with a mild upward drift."""
    candles = []
    price = base_price
    for i in range(n):
        # Small sine-wave oscillation + upward drift
        drift = 50 * math.sin(i / 5.0) + i * 0.5
        o = price
        h = price + abs(drift) + 10
        l = price - abs(drift) - 10
        c = price + drift
        price = c
        candles.append(ReplayCandle(
            timestamp=float(1_700_000_000 + i * 3600),
            open=o, high=h, low=l, close=c, volume=1000.0 + i,
        ))
    return candles


@pytest.fixture
def replayer():
    return Replayer()


@pytest.fixture
def candles_50():
    return _make_candles(50)


@pytest.fixture
def candles_100():
    return _make_candles(100)


@pytest.fixture
def client():
    from backend.app import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# Replayer unit tests
# ---------------------------------------------------------------------------

def test_replay_too_few_candles(replayer):
    """< 26 candles → no signals but valid result."""
    candles = _make_candles(10)
    result = replayer.replay("BTCUSDT", candles)
    assert result.candle_count == 10
    assert result.signals == []
    assert result.deterministic is True


def test_replay_produces_signals(replayer, candles_50):
    result = replayer.replay("BTCUSDT", candles_50)
    assert result.candle_count == 50
    assert len(result.signals) > 0, "Expected at least one signal from 50 candles"


def test_replay_signals_have_valid_sides(replayer, candles_100):
    result = replayer.replay("BTCUSDT", candles_100)
    valid_sides = {"BUY", "SELL", "FLAT"}
    for sig in result.signals:
        assert sig.side in valid_sides, f"Invalid side: {sig.side}"


def test_replay_confidence_in_range(replayer, candles_100):
    result = replayer.replay("BTCUSDT", candles_100)
    for sig in result.signals:
        assert 0.0 <= sig.confidence <= 1.0, f"Confidence out of range: {sig.confidence}"


def test_replay_is_deterministic(replayer, candles_100):
    """Same candles → same output_hash across two independent runs."""
    r1 = replayer.replay("BTCUSDT", candles_100)
    r2 = replayer.replay("BTCUSDT", candles_100)
    assert r1.output_hash == r2.output_hash
    assert r1.deterministic is True


def test_replay_different_candles_different_hash(replayer):
    """Different candle structures → different input_hash."""
    c1 = _make_candles(50, base_price=60000.0)
    # Reverse the candles — structurally different even at same scale
    c2 = list(reversed(_make_candles(50, base_price=60000.0)))
    # Update timestamps so they are chronological for c2
    for i, candle in enumerate(c2):
        candle.timestamp = float(1_700_000_000 + i * 3600)
    r1 = replayer.replay("BTCUSDT", c1)
    r2 = replayer.replay("BTCUSDT", c2)
    # input hashes must differ (different candle sequence)
    assert r1.input_hash != r2.input_hash


def test_replay_input_hash_is_stable(replayer, candles_50):
    """input_hash must be the same across runs for the same candle list."""
    r1 = replayer.replay("BTCUSDT", candles_50)
    r2 = replayer.replay("BTCUSDT", candles_50)
    assert r1.input_hash == r2.input_hash


def test_replay_strategies_all_run(replayer, candles_50):
    """All three strategies complete without error."""
    for strategy_id in ["trend_v1", "mean_reversion_v1", "momentum_v1"]:
        result = replayer.replay("BTCUSDT", candles_50, strategy_id=strategy_id)
        assert result.strategy_id == strategy_id
        assert result.candle_count == 50


def test_replay_from_dict(replayer, candles_50):
    data = {
        "symbol": "ETHUSDT",
        "strategy_id": "trend_v1",
        "candles": [c.to_dict() for c in candles_50],
    }
    result = replayer.replay_from_dict(data)
    assert result.symbol == "ETHUSDT"


def test_replay_result_to_dict(replayer, candles_50):
    result = replayer.replay("BTCUSDT", candles_50)
    d = result.to_dict()
    required_keys = {
        "symbol", "candle_count", "signal_count", "signals",
        "input_hash", "output_hash", "deterministic",
        "elapsed_ms", "strategy_id",
    }
    assert required_keys.issubset(d.keys())


def test_replay_elapsed_ms_positive(replayer, candles_50):
    result = replayer.replay("BTCUSDT", candles_50)
    assert result.elapsed_ms > 0


# ---------------------------------------------------------------------------
# diff utility
# ---------------------------------------------------------------------------

def test_diff_identical_results(replayer, candles_100):
    r1 = replayer.replay("BTCUSDT", candles_100)
    r2 = replayer.replay("BTCUSDT", candles_100)
    diffs = replayer.diff(r1, r2)
    assert diffs == [], f"Expected no diffs, got: {diffs}"


def test_diff_different_results(replayer):
    c1 = _make_candles(50, base_price=60000.0)
    # Reversed candles produce a different input_hash → diff should report it
    c2 = list(reversed(_make_candles(50, base_price=60000.0)))
    for i, candle in enumerate(c2):
        candle.timestamp = float(1_700_000_000 + i * 3600)
    r1 = replayer.replay("BTCUSDT", c1)
    r2 = replayer.replay("BTCUSDT", c2)
    diffs = replayer.diff(r1, r2)
    assert len(diffs) > 0


# ---------------------------------------------------------------------------
# API route tests
# ---------------------------------------------------------------------------

def test_replay_api_too_few_candles(client):
    candles = [{"timestamp": float(1700000000 + i*3600),
                "open": 60000.0, "high": 60100.0, "low": 59900.0,
                "close": 60050.0, "volume": 1000.0} for i in range(10)]
    resp = client.post("/api/v1/replay", json={"symbol": "BTCUSDT", "candles": candles})
    assert resp.status_code == 200
    data = resp.json()
    assert data["signal_count"] == 0
    assert data["deterministic"] is True


def test_replay_api_with_50_candles(client):
    candles = [c.to_dict() for c in _make_candles(50)]
    resp = client.post("/api/v1/replay", json={"symbol": "BTCUSDT", "candles": candles})
    assert resp.status_code == 200
    data = resp.json()
    assert data["candle_count"] == 50
    assert "output_hash" in data
    assert data["deterministic"] is True


def test_replay_api_bad_candles(client):
    resp = client.post("/api/v1/replay", json={
        "symbol": "BTCUSDT",
        "candles": [{"invalid": "data"}],
    })
    assert resp.status_code == 422


def test_replay_api_too_many_candles(client):
    candles = [{"timestamp": float(i), "open": 1.0, "high": 2.0,
                "low": 0.5, "close": 1.5, "volume": 100.0} for i in range(1001)]
    resp = client.post("/api/v1/replay", json={"symbol": "BTCUSDT", "candles": candles})
    assert resp.status_code == 400


def test_replay_strategies_endpoint(client):
    resp = client.get("/api/v1/replay/strategies")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["strategies"]) == 3
    ids = [s["id"] for s in data["strategies"]]
    assert "trend_v1" in ids
    assert "mean_reversion_v1" in ids
    assert "momentum_v1" in ids
    assert data["determinism_guaranteed"] is True
