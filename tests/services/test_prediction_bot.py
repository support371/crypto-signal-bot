# tests/services/test_prediction_bot.py
"""
PHASE 7 — Prediction service tests.

Tests:
  1. Confidence threshold — sub-40 signals become NEUTRAL
  2. CHAOS suppression — direction forced to NEUTRAL, confidence capped
  3. Latest signal output — get_latest_signal returns cached or computes fresh
  4. Service publication — Redis publish called on engine success
  5. Engine unavailable — NOT_AVAILABLE returned, never fake signal
  6. Market data unavailable — unavailable state returned explicitly
  7. Signal route shape

Run: pytest tests/services/test_prediction_bot.py -v
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from backend.services.prediction_bot.service import (
    UNAVAILABLE_SIGNAL,
    SignalOutput,
    _latest_signals,
    compute_signal_for_symbol,
    get_latest_signal,
)
from backend.routes.signal import router as signal_router
from backend.services.market_data.service import MarketDataUnavailable


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(signal_router)
    return a


@pytest.fixture
async def client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_snapshot(symbol: str = "BTCUSDT", price: float = 50000.0):
    from decimal import Decimal
    from backend.services.market_data.service import PriceSnapshot
    return PriceSnapshot(
        symbol=symbol,
        price=Decimal(str(price)),
        bid=Decimal(str(price - 1)),
        ask=Decimal(str(price + 1)),
        spread_pct=0.00004,
        change24h=1.5,
        volume24h=Decimal("999"),
        market_data_mode="paper_live",
        source="test",
        fetched_at=int(time.time()),
        stale=False,
    )


def _make_engine_output(
    direction: str = "UP",
    confidence: float = 75.0,
    regime: str = "TREND",
    horizon: int = 15,
) -> tuple:
    """Returns (compute_features_mock, compute_signal_mock)."""
    features_fn = MagicMock(return_value={"spread": 0.0001, "mid_velocity": 0.3})
    signal_fn   = MagicMock(return_value={
        "direction":  direction,
        "confidence": confidence,
        "regime":     regime,
        "horizon":    horizon,
        "reasoning":  "test signal",
    })
    return features_fn, signal_fn


# ---------------------------------------------------------------------------
# 1. Confidence threshold
# ---------------------------------------------------------------------------

class TestConfidenceThreshold:
    @pytest.mark.asyncio
    async def test_sub40_confidence_becomes_neutral(self):
        features_fn, signal_fn = _make_engine_output(
            direction="UP", confidence=35.0, regime="RANGE"
        )
        snapshot = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
            patch("backend.services.prediction_bot.service._publish_signal", new=AsyncMock()),
        ):
            sig = await compute_signal_for_symbol("BTCUSDT")

        assert sig.direction == "NEUTRAL"
        assert sig.confidence == pytest.approx(35.0)
        assert sig.available is True

    @pytest.mark.asyncio
    async def test_40_confidence_passes_through(self):
        features_fn, signal_fn = _make_engine_output(
            direction="DOWN", confidence=40.0, regime="RANGE"
        )
        snapshot = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
            patch("backend.services.prediction_bot.service._publish_signal", new=AsyncMock()),
        ):
            sig = await compute_signal_for_symbol("BTCUSDT")

        assert sig.direction == "DOWN"


# ---------------------------------------------------------------------------
# 2. CHAOS suppression
# ---------------------------------------------------------------------------

class TestChaosSupppression:
    @pytest.mark.asyncio
    async def test_chaos_regime_forces_neutral(self):
        """CHAOS regime: direction must be NEUTRAL regardless of engine output."""
        features_fn, signal_fn = _make_engine_output(
            direction="UP", confidence=90.0, regime="CHAOS"
        )
        snapshot = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
            patch("backend.services.prediction_bot.service._publish_signal", new=AsyncMock()),
        ):
            sig = await compute_signal_for_symbol("BTCUSDT")

        assert sig.direction == "NEUTRAL"
        assert sig.regime == "CHAOS"
        assert sig.confidence <= 20.0  # capped in CHAOS

    @pytest.mark.asyncio
    async def test_chaos_caps_confidence_at_20(self):
        features_fn, signal_fn = _make_engine_output(
            direction="DOWN", confidence=85.0, regime="CHAOS"
        )
        snapshot = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
            patch("backend.services.prediction_bot.service._publish_signal", new=AsyncMock()),
        ):
            sig = await compute_signal_for_symbol("ETHUSDT")

        assert sig.confidence <= 20.0


# ---------------------------------------------------------------------------
# 3. Latest signal output
# ---------------------------------------------------------------------------

class TestLatestSignalOutput:
    @pytest.mark.asyncio
    async def test_get_latest_returns_cached_within_horizon(self):
        """get_latest_signal() returns cached signal if within 2×horizon."""
        fresh_sig = SignalOutput(
            symbol="BTCUSDT", direction="UP", confidence=70.0,
            regime="TREND", horizon=15, available=True,
            source="signal_engine", computed_at=int(time.time()),
        )
        _latest_signals["BTCUSDT"] = fresh_sig

        result = await get_latest_signal("BTCUSDT")
        assert result is fresh_sig

    @pytest.mark.asyncio
    async def test_get_latest_recomputes_when_stale(self):
        """Stale signal triggers recomputation (not serving stale as fresh)."""
        old_sig = SignalOutput(
            symbol="BTCUSDT", direction="DOWN", confidence=60.0,
            regime="RANGE", horizon=15, available=True,
            source="signal_engine",
            computed_at=int(time.time()) - 9999,  # very old
        )
        _latest_signals["BTCUSDT"] = old_sig

        features_fn, signal_fn = _make_engine_output(direction="UP", confidence=65.0)
        snapshot = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
            patch("backend.services.prediction_bot.service._publish_signal", new=AsyncMock()),
        ):
            result = await get_latest_signal("BTCUSDT")

        # Should have recomputed
        assert result.direction == "UP"
        assert result.computed_at > old_sig.computed_at


# ---------------------------------------------------------------------------
# 4. Service publication
# ---------------------------------------------------------------------------

class TestSignalPublication:
    @pytest.mark.asyncio
    async def test_publish_called_on_engine_success(self):
        features_fn, signal_fn = _make_engine_output(confidence=65.0)
        snapshot = _make_snapshot()
        mock_publish = AsyncMock()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
            patch("backend.services.prediction_bot.service._publish_signal", mock_publish),
        ):
            await compute_signal_for_symbol("BTCUSDT")

        mock_publish.assert_called_once()
        call_args = mock_publish.call_args[0]
        assert call_args[0] == "BTCUSDT"
        assert isinstance(call_args[1], SignalOutput)


# ---------------------------------------------------------------------------
# 5. Engine unavailable
# ---------------------------------------------------------------------------

class TestEngineUnavailable:
    @pytest.mark.asyncio
    async def test_engine_none_returns_unavailable_not_mock(self):
        """When engine modules are missing: NOT_AVAILABLE, never mock signal."""
        snapshot = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(None, None)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
        ):
            sig = await compute_signal_for_symbol("BTCUSDT")

        assert sig.available is False
        assert sig.source == "unavailable"
        assert sig.direction == "NEUTRAL"
        # Must explicitly state it's unavailable, not fabricated
        assert "not" in (sig.reasoning or "").lower() or "unavailable" in (sig.source or "")

    @pytest.mark.asyncio
    async def test_engine_error_returns_unavailable(self):
        """Engine runtime error returns unavailable state, not a fake direction."""
        features_fn = MagicMock(side_effect=RuntimeError("engine crash"))
        signal_fn   = MagicMock()
        snapshot    = _make_snapshot()

        with (
            patch("backend.services.prediction_bot.service.get_price",
                  new=AsyncMock(return_value=snapshot)),
            patch("backend.services.prediction_bot.service._try_import_signal_engine",
                  return_value=(signal_fn, features_fn)),
            patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()),
        ):
            sig = await compute_signal_for_symbol("BTCUSDT")

        assert sig.available is False
        assert sig.source == "engine_error"


# ---------------------------------------------------------------------------
# 6. Market data unavailable
# ---------------------------------------------------------------------------

class TestMarketDataUnavailableForSignal:
    @pytest.mark.asyncio
    async def test_signal_returns_unavailable_when_price_fails(self):
        with patch("backend.services.prediction_bot.service.get_price",
                   new=AsyncMock(side_effect=MarketDataUnavailable("all down"))):
            with patch("backend.services.prediction_bot.service._cache_signal", new=AsyncMock()):
                sig = await compute_signal_for_symbol("BTCUSDT")

        assert sig.available is False
        assert sig.direction == "NEUTRAL"
        assert "unavailable" in sig.reasoning.lower()


# ---------------------------------------------------------------------------
# 7. Signal route shape
# ---------------------------------------------------------------------------

class TestSignalRoute:
    @pytest.mark.asyncio
    async def test_signal_route_returns_correct_shape(self, client: AsyncClient):
        mock_sig = SignalOutput(
            symbol="BTCUSDT", direction="UP", confidence=72.0,
            regime="TREND", horizon=15, available=True,
            source="signal_engine", computed_at=int(time.time()),
            reasoning="test",
        )

        with patch("backend.routes.signal.get_latest_signal",
                   new=AsyncMock(return_value=mock_sig)):
            resp = await client.get("/signal/latest?symbol=BTCUSDT")

        assert resp.status_code == 200
        data = resp.json()
        for field in ["symbol", "direction", "confidence", "regime",
                      "horizon", "available", "source", "computed_at"]:
            assert field in data, f"Missing field: {field}"

    @pytest.mark.asyncio
    async def test_unavailable_signal_available_false_not_404(self, client: AsyncClient):
        """Unavailable signal returns 200 with available=False — not 404 or 503."""
        with patch("backend.routes.signal.get_latest_signal",
                   new=AsyncMock(return_value=UNAVAILABLE_SIGNAL)):
            resp = await client.get("/signal/latest?symbol=SOLUSDT")

        assert resp.status_code == 200
        assert resp.json()["available"] is False
