"""API contract tests: validate response schemas for CLAUDE.md endpoints.

Ensures each endpoint returns the expected structure so the frontend
can rely on a stable contract.
"""

import backend.app as app_module
from fastapi.testclient import TestClient


def _client():
    return TestClient(app_module.app)


class TestHealthContract:
    def test_returns_200(self):
        resp = _client().get("/health")
        assert resp.status_code == 200

    def test_response_is_dict(self):
        data = _client().get("/health").json()
        assert isinstance(data, dict)

    def test_required_keys(self):
        data = _client().get("/health").json()
        for key in ("status", "mode", "network", "adapter",
                     "kill_switch_active", "uptime_seconds"):
            assert key in data, f"Missing key: {key}"

    def test_status_is_ok(self):
        data = _client().get("/health").json()
        assert data["status"] == "ok"

    def test_uptime_is_number(self):
        data = _client().get("/health").json()
        assert isinstance(data["uptime_seconds"], (int, float))
        assert data["uptime_seconds"] >= 0

    def test_kill_switch_is_bool(self):
        data = _client().get("/health").json()
        assert isinstance(data["kill_switch_active"], bool)

    def test_healthz_alias(self):
        resp = _client().get("/healthz")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestBalanceContract:
    def test_returns_200(self):
        resp = _client().get("/balance")
        assert resp.status_code == 200

    def test_response_has_balances_and_positions(self):
        data = _client().get("/balance").json()
        assert "balances" in data
        assert "positions" in data

    def test_balances_is_dict(self):
        data = _client().get("/balance").json()
        assert isinstance(data["balances"], dict)

    def test_positions_is_list(self):
        data = _client().get("/balance").json()
        assert isinstance(data["positions"], list)


class TestPositionsContract:
    def test_returns_200(self):
        resp = _client().get("/positions")
        assert resp.status_code == 200

    def test_response_has_positions_key(self):
        data = _client().get("/positions").json()
        assert "positions" in data

    def test_positions_is_list(self):
        data = _client().get("/positions").json()
        assert isinstance(data["positions"], list)


class TestOrdersContract:
    def test_returns_200(self):
        resp = _client().get("/orders")
        assert resp.status_code == 200

    def test_response_has_orders_key(self):
        data = _client().get("/orders").json()
        assert "orders" in data

    def test_orders_is_list(self):
        data = _client().get("/orders").json()
        assert isinstance(data["orders"], list)

    def test_symbol_filter_returns_200(self):
        resp = _client().get("/orders?symbol=BTCUSDT")
        assert resp.status_code == 200
        assert isinstance(resp.json()["orders"], list)


class TestSignalLatestContract:
    def test_returns_200(self):
        resp = _client().get("/signal/latest")
        assert resp.status_code == 200

    def test_response_has_available_key(self):
        data = _client().get("/signal/latest").json()
        assert "available" in data
        assert isinstance(data["available"], bool)

    def test_unavailable_has_message(self):
        data = _client().get("/signal/latest").json()
        if not data["available"]:
            assert "message" in data

    def test_symbol_filter_returns_200(self):
        resp = _client().get("/signal/latest?symbol=BTCUSDT")
        assert resp.status_code == 200
        data = resp.json()
        assert "available" in data


class TestGuardianStatusContract:
    def test_returns_200(self):
        resp = _client().get("/guardian/status")
        assert resp.status_code == 200

    def test_response_is_dict(self):
        data = _client().get("/guardian/status").json()
        assert isinstance(data, dict)

    def test_required_keys(self):
        data = _client().get("/guardian/status").json()
        for key in ("kill_switch_active", "triggered", "drawdown_pct",
                     "api_error_count", "failed_order_count"):
            assert key in data, f"Missing key: {key}"

    def test_kill_switch_is_bool(self):
        data = _client().get("/guardian/status").json()
        assert isinstance(data["kill_switch_active"], bool)

    def test_drawdown_is_number(self):
        data = _client().get("/guardian/status").json()
        assert isinstance(data["drawdown_pct"], (int, float))

    def test_has_thresholds(self):
        data = _client().get("/guardian/status").json()
        assert "thresholds" in data
        assert isinstance(data["thresholds"], dict)
