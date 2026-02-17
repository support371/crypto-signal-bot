"""Tests for API endpoints."""

import pytest
from fastapi.testclient import TestClient

from backend.app import app


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "kill_switch_active" in data
        assert "mode" in data
        assert data["halted"] is False

    def test_health_has_mode(self, client):
        resp = client.get("/health")
        assert resp.json()["mode"] in ("paper", "live")


class TestConfigEndpoint:
    def test_config_no_secrets(self, client):
        resp = client.get("/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "trading_mode" in data
        # Ensure no API keys leaked
        assert "BINANCE_API_KEY" not in str(data)
        assert "BINANCE_API_SECRET" not in str(data)


class TestBalanceEndpoint:
    def test_balance_structure(self, client):
        resp = client.get("/balance")
        assert resp.status_code == 200
        data = resp.json()
        assert "balances" in data
        assert "positions" in data


class TestPriceEndpoint:
    def test_price_default(self, client):
        resp = client.get("/price")
        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "BTCUSDT"
        assert data["price"] > 0

    def test_price_with_symbol(self, client):
        resp = client.get("/price?symbol=ETHUSDT")
        assert resp.status_code == 200
        assert resp.json()["symbol"] == "ETHUSDT"


class TestOrdersEndpoint:
    def test_orders_empty_initially(self, client):
        resp = client.get("/orders")
        assert resp.status_code == 200
        assert resp.json()["orders"] == []


class TestAuditEndpoint:
    def test_audit_structure(self, client):
        resp = client.get("/audit")
        assert resp.status_code == 200
        data = resp.json()
        assert "intents" in data
        assert "orders" in data
        assert "withdrawals" in data
        assert "risk_events" in data


class TestIntentPaper:
    def test_paper_intent_buy(self, client):
        resp = client.post("/intent/paper", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": 0.001,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert "status" in data
        assert data["status"] in ("FILLED", "RISK_REJECTED", "FAILED")

    def test_paper_intent_returns_notes(self, client):
        resp = client.post("/intent/paper", json={
            "symbol": "ETHUSDT",
            "side": "BUY",
            "quantity": 0.01,
        })
        data = resp.json()
        assert "notes" in data


class TestIntentLive:
    def test_live_intent_routes_paper_mode(self, client):
        resp = client.post("/intent/live", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("FILLED", "RISK_REJECTED", "FAILED")


class TestWithdraw:
    def test_withdraw_success(self, client):
        resp = client.post("/withdraw", json={
            "asset": "USDT",
            "amount": 100.0,
            "address": "test-wallet",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_withdraw_insufficient(self, client):
        resp = client.post("/withdraw", json={
            "asset": "USDT",
            "amount": 999999999.0,
        })
        assert resp.status_code == 400


class TestLegacyEndpoints:
    def test_analyze_features(self, client):
        resp = client.post("/analyze-features", json={
            "spread_pct": 0.02,
            "imbalance": 0.1,
            "mid_vel": 0.006,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "signal" in data
        assert "risk_score" in data
        assert "decision" in data

    def test_simulate_session(self, client):
        resp = client.post("/simulate-session", json={
            "steps": 5,
            "start_price": 30000.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["steps"]) == 5


class TestWebSocket:
    def test_ws_connect_and_receive_health(self, client):
        with client.websocket_connect("/ws/updates") as ws:
            data = ws.receive_json()
            assert data["type"] == "health"
            assert "kill_switch_active" in data
            assert "mode" in data
