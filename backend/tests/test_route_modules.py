"""Tests for extracted route modules (audit_v1, earnings_v1, analysis_v1)."""

import backend.app as app_module
from fastapi.testclient import TestClient


def _client():
    return TestClient(app_module.app)


class TestAuditRoutes:
    def test_get_audit_returns_dict(self):
        resp = _client().get("/audit")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)

    def test_get_traces_returns_list(self):
        resp = _client().get("/traces")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_traces_with_filters(self):
        resp = _client().get("/traces?symbol=BTCUSDT&status=filled&limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_trace_not_found(self):
        resp = _client().get("/trace/nonexistent-id")
        assert resp.status_code == 404

    def test_get_metrics(self):
        resp = _client().get("/metrics")
        assert resp.status_code == 200


class TestAnalysisRoutes:
    def test_analyze_features_defaults(self):
        resp = _client().post("/analyze-features", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert "signal" in data
        assert "risk_score" in data
        assert "decision" in data
        assert isinstance(data["risk_score"], float)

    def test_analyze_features_custom(self):
        resp = _client().post("/analyze-features", json={
            "spread_pct": 0.05,
            "imbalance": 0.3,
            "vol_spike": True,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["risk_score"] > 0

    def test_simulate_session_defaults(self):
        resp = _client().post("/simulate-session", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "BTC/USDT"
        assert len(data["steps"]) == 30

    def test_simulate_session_custom_steps(self):
        resp = _client().post("/simulate-session", json={"steps": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["steps"]) == 5

    def test_simulate_session_step_structure(self):
        resp = _client().post("/simulate-session", json={"steps": 1})
        assert resp.status_code == 200
        step = resp.json()["steps"][0]
        assert "step" in step
        assert "price" in step
        assert "signal" in step
        assert "risk_score" in step
        assert "decision" in step


class TestEarningsRoutes:
    def setup_method(self):
        self._original_key = app_module.BACKEND_API_KEY
        app_module.BACKEND_API_KEY = ""

    def teardown_method(self):
        app_module.BACKEND_API_KEY = self._original_key

    def test_get_earnings_summary(self):
        resp = _client().get("/earnings/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)

    def test_get_earnings_history(self):
        resp = _client().get("/earnings/history")
        assert resp.status_code == 200
        data = resp.json()
        assert "trades" in data
        assert isinstance(data["trades"], list)

    def test_get_earnings_history_with_filters(self):
        resp = _client().get("/earnings/history?symbol=BTCUSDT&limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert "trades" in data

    def test_reset_earnings_no_auth(self):
        app_module.BACKEND_API_KEY = ""
        resp = _client().post("/earnings/reset")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_reset_earnings_requires_auth(self):
        app_module.BACKEND_API_KEY = "secret"
        resp = _client().post("/earnings/reset")
        assert resp.status_code == 401

    def test_reset_earnings_with_valid_auth(self):
        app_module.BACKEND_API_KEY = "secret"
        resp = _client().post("/earnings/reset", headers={"X-API-Key": "secret"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
