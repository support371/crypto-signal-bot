# backend/tests/test_idempotency.py
"""
Tests for intent idempotency — AGENTS.md rule 9:
"Every executable intent requires a deterministic idempotency key
and atomic duplicate rejection."
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import backend.app as app_module


@pytest.fixture()
def client():
    return TestClient(app_module.app)


@pytest.fixture(autouse=True)
def _clear_idempotency_cache():
    app_module._IDEMPOTENCY_CACHE.clear()
    yield
    app_module._IDEMPOTENCY_CACHE.clear()


class TestIdempotencyDedup:
    def test_first_intent_succeeds(self, client):
        resp = client.post("/intent/paper", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
            "idempotency_key": "test-key-001",
        }, headers={"X-API-Key": app_module.BACKEND_API_KEY})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] != "DUPLICATE_REJECTED"
        assert data["id"]

    def test_duplicate_intent_rejected(self, client):
        payload = {
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
            "idempotency_key": "test-key-002",
        }
        headers = {"X-API-Key": app_module.BACKEND_API_KEY}

        resp1 = client.post("/intent/paper", json=payload, headers=headers)
        assert resp1.status_code == 200
        original_id = resp1.json()["id"]

        resp2 = client.post("/intent/paper", json=payload, headers=headers)
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["status"] == "DUPLICATE_REJECTED"
        assert data2["id"] == original_id
        assert "idempotency_key" in data2["notes"]

    def test_no_idempotency_key_allows_duplicates(self, client):
        payload = {
            "symbol": "BTCUSDT",
            "side": "BUY",
            "quantity": 0.001,
        }
        headers = {"X-API-Key": app_module.BACKEND_API_KEY}

        resp1 = client.post("/intent/paper", json=payload, headers=headers)
        resp2 = client.post("/intent/paper", json=payload, headers=headers)

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["id"] != resp2.json()["id"]

    def test_different_keys_both_succeed(self, client):
        headers = {"X-API-Key": app_module.BACKEND_API_KEY}

        resp1 = client.post("/intent/paper", json={
            "symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001,
            "idempotency_key": "key-a",
        }, headers=headers)

        resp2 = client.post("/intent/paper", json={
            "symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001,
            "idempotency_key": "key-b",
        }, headers=headers)

        assert resp1.json()["status"] != "DUPLICATE_REJECTED"
        assert resp2.json()["status"] != "DUPLICATE_REJECTED"
        assert resp1.json()["id"] != resp2.json()["id"]


class TestIdempotencyCache:
    def test_check_returns_none_for_unknown_key(self):
        assert app_module._check_idempotency("nonexistent") is None

    def test_check_returns_none_for_none_key(self):
        assert app_module._check_idempotency(None) is None

    def test_record_and_check(self):
        app_module._record_idempotency("my-key", "intent-123")
        assert app_module._check_idempotency("my-key") == "intent-123"

    def test_record_none_key_is_noop(self):
        app_module._record_idempotency(None, "intent-456")
        assert len(app_module._IDEMPOTENCY_CACHE) == 0

    def test_cache_eviction_at_max_size(self):
        for i in range(app_module._IDEMPOTENCY_CACHE_MAX + 1):
            app_module._record_idempotency(f"key-{i}", f"intent-{i}")
        assert len(app_module._IDEMPOTENCY_CACHE) <= app_module._IDEMPOTENCY_CACHE_MAX


class TestIdempotencyKeyOnModel:
    def test_intent_request_accepts_idempotency_key(self):
        from backend.models.execution_intent import IntentRequest
        req = IntentRequest(
            symbol="BTCUSDT", side="BUY", quantity=0.001,
            idempotency_key="req-key-123",
        )
        assert req.idempotency_key == "req-key-123"

    def test_intent_request_defaults_none(self):
        from backend.models.execution_intent import IntentRequest
        req = IntentRequest(symbol="BTCUSDT", side="BUY", quantity=0.001)
        assert req.idempotency_key is None

    def test_execution_intent_accepts_idempotency_key(self):
        from backend.models.execution_intent import ExecutionIntent
        intent = ExecutionIntent(
            symbol="BTCUSDT", side="BUY", quantity=0.001,
            idempotency_key="intent-key-456",
        )
        assert intent.idempotency_key == "intent-key-456"
