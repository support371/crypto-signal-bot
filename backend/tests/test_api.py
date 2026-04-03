"""Tests for API endpoints."""

import pytest
from fastapi.testclient import TestClient

import backend.app as app_module
from backend.app import app


@pytest.fixture(autouse=True)
def reset_state():
    """Reset shared mutable state between tests."""
    app_module.kill_switch_active = False
    app_module.kill_switch_reason = None
    app_module.api_error_count = 0
    app_module.failed_order_count = 0
    app_module._latest_signal = None
    app_module._latest_signal_ts = None
    app_module._guardian_triggered = False
    app_module._guardian_trigger_reason = None
    app_module._guardian_trigger_ts = None
    app_module._guardian_drawdown_pct = 0.0
    app_module.BACKEND_API_KEY = ""
    app_module.paper_portfolio.balances = {"USDT": 10000.0}
    app_module.paper_portfolio.positions = []
    app_module.paper_portfolio.open_orders = []
    app_module.paper_portfolio.filled_orders = []
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_client():
    """Client with auth key configured."""
    app_module.BACKEND_API_KEY = "test-secret-key"
    client = TestClient(app)
    client.headers.update({"X-API-Key": "test-secret-key"})
    return client


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "kill_switch_active" in data
        assert "mode" in data
        assert data["halted"] is False
        assert "guardian_triggered" in data

    def test_health_has_mode(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["mode"] in ("paper", "live")


class TestConfigEndpoint:
    def test_config_no_secrets(self, client):
        resp = client.get("/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "trading_mode" in data
        assert "auth_enabled" in data
        assert "rate_limit_rpm" in data
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


class TestPositionsEndpoint:
    def test_positions_structure(self, client):
        resp = client.get("/positions")
        assert resp.status_code == 200
        assert "positions" in resp.json()

    def test_positions_list(self, client):
        positions = client.get("/positions").json()["positions"]
        assert isinstance(positions, list)


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


class TestSignalLatest:
    def test_signal_latest_no_data(self, client):
        resp = client.get("/signal/latest")
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False

    def test_signal_latest_after_market_state(self, client):
        client.post("/market-state", json={
            "symbol": "BTCUSDT",
            "price": 43000.0,
            "change24h": 2.5,
            "volume24h": 1e9,
            "marketCap": 8e11,
        })
        resp = client.get("/signal/latest")
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is True
        assert "signal" in data
        assert "risk" in data
        assert "timestamp" in data


class TestGuardianStatus:
    def test_guardian_status_structure(self, client):
        resp = client.get("/guardian/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "triggered" in data
        assert "kill_switch_active" in data
        assert "drawdown_pct" in data
        assert "api_error_count" in data
        assert "failed_order_count" in data
        assert "thresholds" in data

    def test_guardian_not_triggered_initially(self, client):
        data = client.get("/guardian/status").json()
        assert data["triggered"] is False
        assert data["kill_switch_active"] is False


class TestKillSwitch:
    def test_kill_switch_activate_no_auth_when_key_not_set(self, client):
        resp = client.post("/kill-switch", json={"activate": True, "reason": "test"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["kill_switch_active"] is True
        assert data["kill_switch_reason"] == "test"

    def test_kill_switch_requires_auth_when_key_set(self, client):
        app_module.BACKEND_API_KEY = "secret"
        resp = client.post("/kill-switch", json={"activate": True})
        assert resp.status_code == 401

    def test_kill_switch_activate_with_auth(self, auth_client):
        resp = auth_client.post("/kill-switch", json={"activate": True, "reason": "halt"})
        assert resp.status_code == 200
        assert resp.json()["kill_switch_active"] is True

    def test_kill_switch_deactivate(self, client):
        app_module.kill_switch_active = True
        app_module.kill_switch_reason = "test halt"
        resp = client.post("/kill-switch", json={"activate": False})
        assert resp.status_code == 200
        data = resp.json()
        assert data["kill_switch_active"] is False
        assert data["kill_switch_reason"] is None

    def test_health_reflects_kill_switch(self, client):
        client.post("/kill-switch", json={"activate": True, "reason": "manual test"})
        health = client.get("/health").json()
        assert health["kill_switch_active"] is True
        assert health["halted"] is True


class TestAuthEnforcement:
    def test_intent_paper_open_when_no_key(self, client):
        resp = client.post("/intent/paper", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
        })
        assert resp.status_code == 200

    def test_intent_paper_blocked_without_key_when_auth_enabled(self, client):
        app_module.BACKEND_API_KEY = "secret"
        resp = client.post("/intent/paper", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
        })
        assert resp.status_code == 401

    def test_intent_paper_allowed_with_valid_key(self, auth_client):
        resp = auth_client.post("/intent/paper", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
        })
        assert resp.status_code == 200

    def test_withdraw_blocked_without_key_when_auth_enabled(self, client):
        app_module.BACKEND_API_KEY = "secret"
        resp = client.post("/withdraw", json={"asset": "USDT", "amount": 10.0})
        assert resp.status_code == 401


class TestRateLimiting:
    def test_rate_limit_not_hit_on_normal_usage(self, client):
        for _ in range(5):
            resp = client.get("/health")
            assert resp.status_code == 200

    def test_rate_limit_triggers_after_threshold(self, client):
        original_limit = app_module._rate_limit_max_requests
        app_module._rate_limit_max_requests = 3
        app_module._rate_limit_store.clear()
        try:
            results = []
            for _ in range(5):
                results.append(client.get("/health").status_code)
            assert 429 in results
        finally:
            app_module._rate_limit_max_requests = original_limit
            app_module._rate_limit_store.clear()


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

    def test_live_intent_blocked_by_kill_switch(self, client):
        app_module.kill_switch_active = True
        app_module.kill_switch_reason = "test halt"
        resp = client.post("/intent/live", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
        })
        assert resp.status_code == 503


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


class TestMarketState:
    def test_market_state_full_response(self, client):
        resp = client.post("/market-state", json={
            "symbol": "BTCUSDT",
            "price": 43000.0,
            "change24h": 3.0,
            "volume24h": 1.5e9,
            "marketCap": 8.5e11,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "signal" in data
        assert "risk" in data
        assert "microstructure" in data
        assert "backend" in data
        assert data["signal"]["direction"] in ("UP", "DOWN", "NEUTRAL")
        assert 0 <= data["signal"]["confidence"] <= 100
        assert data["signal"]["regime"] in ("TREND", "RANGE", "CHAOS")

    def test_market_state_caches_for_signal_latest(self, client):
        client.post("/market-state", json={
            "symbol": "BTCUSDT",
            "price": 43000.0,
            "change24h": 1.0,
        })
        signal_resp = client.get("/signal/latest")
        assert signal_resp.json()["available"] is True


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
            assert "guardian_triggered" in data
