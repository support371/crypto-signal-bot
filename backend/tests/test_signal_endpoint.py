"""Tests for the prediction-service-backed /signal/latest endpoint."""

import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

import backend.app as app_module
from backend.services.prediction_bot.service import SignalOutput


@pytest.fixture()
def client():
    return TestClient(app_module.app)


class TestSignalLatestEndpoint:
    def test_no_symbol_returns_unavailable(self, client):
        resp = client.get("/signal/latest")
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False
        assert "message" in data
        assert data["direction"] == "NEUTRAL"
        assert data["side"] == "NEUTRAL"

    def test_with_symbol_returns_expected_shape(self, client):
        mock_signal = SignalOutput(
            symbol="BTCUSDT",
            direction="UP",
            confidence=72.5,
            regime="TREND",
            horizon=15,
            available=True,
            source="signal_engine",
            computed_at=1700000000,
            reasoning="Strong bullish momentum detected.",
        )
        with patch(
            "backend.routes.signal.get_latest_signal",
            new_callable=AsyncMock,
            return_value=mock_signal,
        ):
            resp = client.get("/signal/latest?symbol=BTCUSDT")

        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is True
        assert data["symbol"] == "BTCUSDT"
        assert data["direction"] == "UP"
        assert data["side"] == "BUY"
        assert data["confidence"] == 72.5
        assert data["regime"] == "TREND"
        assert data["horizon"] == 15
        assert data["source"] == "signal_engine"
        assert data["computed_at"] == 1700000000
        assert data["reasoning"] == "Strong bullish momentum detected."
        assert data["message"] is None

    def test_unavailable_signal_has_message(self, client):
        mock_signal = SignalOutput(
            symbol="ETHUSDT",
            direction="NEUTRAL",
            confidence=0.0,
            regime="CHAOS",
            horizon=0,
            available=False,
            source="unavailable",
            computed_at=1700000000,
            reasoning="Market data unavailable: feed disconnected",
        )
        with patch(
            "backend.routes.signal.get_latest_signal",
            new_callable=AsyncMock,
            return_value=mock_signal,
        ):
            resp = client.get("/signal/latest?symbol=ETHUSDT")

        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False
        assert data["message"] == "Market data unavailable: feed disconnected"
        assert data["side"] == "NEUTRAL"

    def test_side_maps_sell(self, client):
        mock_signal = SignalOutput(
            symbol="BTCUSDT",
            direction="DOWN",
            confidence=65.0,
            regime="TREND",
            horizon=15,
            available=True,
            source="signal_engine",
            computed_at=1700000000,
        )
        with patch(
            "backend.routes.signal.get_latest_signal",
            new_callable=AsyncMock,
            return_value=mock_signal,
        ):
            resp = client.get("/signal/latest?symbol=BTCUSDT")

        data = resp.json()
        assert data["direction"] == "DOWN"
        assert data["side"] == "SELL"

    def test_symbol_normalized_to_uppercase(self, client):
        mock_signal = SignalOutput(
            symbol="BTCUSDT",
            direction="NEUTRAL",
            confidence=0.0,
            regime="RANGE",
            horizon=15,
            available=False,
            source="unavailable",
            computed_at=0,
            reasoning="Signal engine not yet wired.",
        )
        with patch(
            "backend.routes.signal.get_latest_signal",
            new_callable=AsyncMock,
            return_value=mock_signal,
        ) as mock_fn:
            client.get("/signal/latest?symbol=btcusdt")
            mock_fn.assert_called_once_with("BTCUSDT")


class TestPredictionStatus:
    def test_returns_expected_shape(self, client):
        resp = client.get("/prediction/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "running" in data
        assert isinstance(data["running"], bool)
        assert "cached_symbols" in data
        assert isinstance(data["cached_symbols"], list)
        assert "tracked_symbols" in data
        assert isinstance(data["tracked_symbols"], int)
