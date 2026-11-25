"""Tests for the shared dependencies module (backend/dependencies.py)."""

import backend.app as app_module
from fastapi.testclient import TestClient


class TestRequireAuth:
    """Verify require_auth reads BACKEND_API_KEY from the app module."""

    def setup_method(self):
        self._original_key = app_module.BACKEND_API_KEY
        app_module.BACKEND_API_KEY = ""

    def teardown_method(self):
        app_module.BACKEND_API_KEY = self._original_key

    def test_no_key_configured_allows_request(self):
        app_module.BACKEND_API_KEY = ""
        client = TestClient(app_module.app)
        resp = client.post("/earnings/reset")
        assert resp.status_code == 200

    def test_key_configured_rejects_missing_header(self):
        app_module.BACKEND_API_KEY = "test-key"
        client = TestClient(app_module.app)
        resp = client.post("/earnings/reset")
        assert resp.status_code == 401

    def test_key_configured_rejects_wrong_header(self):
        app_module.BACKEND_API_KEY = "test-key"
        client = TestClient(app_module.app)
        resp = client.post("/earnings/reset", headers={"X-API-Key": "wrong"})
        assert resp.status_code == 401

    def test_key_configured_accepts_correct_header(self):
        app_module.BACKEND_API_KEY = "test-key"
        client = TestClient(app_module.app)
        resp = client.post("/earnings/reset", headers={"X-API-Key": "test-key"})
        assert resp.status_code == 200
