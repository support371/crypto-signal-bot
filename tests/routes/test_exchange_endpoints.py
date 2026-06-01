# tests/routes/test_exchange_endpoints.py
"""
Contract tests for new exchange endpoints:
  GET /exchange/supported
  GET /market/feed/status
  POST /exchange/test-connection
  GET /version
  GET /runtime/status
  GET /config/snapshot
"""
import pytest
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_exchange_supported_returns_all_four():
    r = client.get("/exchange/supported")
    assert r.status_code == 200
    data = r.json()
    ids = [e["id"] for e in data["supported"]]
    assert "binance" in ids
    assert "bitget" in ids
    assert "btcc" in ids
    assert "coinbase" in ids


def test_exchange_supported_live_disabled():
    r = client.get("/exchange/supported")
    data = r.json()
    assert data["live_execution_enabled"] is False
    assert data["withdrawals_enabled"] is False
    assert data["execution_adapter"] == "paper"


def test_exchange_supported_coinbase_in_list():
    r = client.get("/exchange/supported")
    data = r.json()
    coinbase = next(e for e in data["supported"] if e["id"] == "coinbase")
    assert coinbase["live_execution_enabled"] is False
    assert coinbase["public_market_data"] is True


def test_market_feed_status_shape():
    r = client.get("/market/feed/status")
    assert r.status_code == 200
    data = r.json()
    assert "source" in data
    assert "connected" in data
    assert "stale" in data
    assert "symbol_count" in data


def test_exchange_test_connection_unsupported():
    r = client.post("/exchange/test-connection?exchange=fakexchange")
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "safe"
    assert "reason" in data


def test_exchange_test_connection_no_real_orders():
    r = client.post("/exchange/test-connection?exchange=coinbase")
    assert r.status_code == 200
    data = r.json()
    assert data["live_orders_attempted"] is False
    assert data["secrets_exposed"] is False
    assert data["test_type"] == "public_market_data"


def test_version_shape():
    r = client.get("/version")
    assert r.status_code == 200
    data = r.json()
    assert "version" in data
    assert data["live_execution_enabled"] is False
    assert data["withdrawals_enabled"] is False
    assert data["paper_only"] is True


def test_runtime_status_shape():
    r = client.get("/runtime/status")
    assert r.status_code == 200
    data = r.json()
    assert "mode" in data
    assert "safe_mode" in data
    assert data["live_execution_enabled"] is False
    assert data["withdrawals_enabled"] is False


def test_config_snapshot_no_secrets():
    r = client.get("/config/snapshot")
    assert r.status_code == 200
    data = r.json()
    assert "config_hash" in data
    # Must not expose raw secrets
    for key in data:
        assert "secret" not in key.lower()
        assert "password" not in key.lower()
        assert "api_key" not in key.lower()


def test_intent_live_returns_403():
    """Phase 2 safety: /intent/live must return 403 in paper mode."""
    r = client.post("/intent/live", json={"symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001})
    assert r.status_code == 403
    data = r.json()
    assert data["detail"]["reason"] == "live_execution_disabled"


def test_withdraw_returns_403():
    """Phase 2 safety: /withdraw must return 403 (withdrawals disabled)."""
    r = client.post("/withdraw", json={"asset": "USDT", "amount": 100, "address": "0xabc"})
    assert r.status_code == 403
    data = r.json()
    assert data["detail"]["reason"] == "withdrawals_disabled"
