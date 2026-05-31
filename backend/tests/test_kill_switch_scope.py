"""Regression tests for scoped guardian kill-switch controls."""

from fastapi.testclient import TestClient

import backend.app as app_module
import backend.services.guardian_bot.service as guardian_service
from backend.app import app
from backend.logic import context as context_module
from backend.logic.exchange_adapter import build_adapter
from backend.logic.paper_trading import _synthetic_price


def _reset_runtime_state() -> None:
    """Reset shared mutable runtime state touched by kill-switch tests."""
    context_module.kill_switch_active = False
    context_module.kill_switch_reason = None
    context_module.api_error_count = 0
    context_module.failed_order_count = 0
    context_module.guardian_triggered = False
    context_module.guardian_trigger_reason = None
    context_module.guardian_trigger_ts = None
    context_module.guardian_drawdown_pct = 0.0
    context_module.guardian_starting_nav = 10000.0
    context_module.market_data_service = None
    context_module.ws_clients = set()
    context_module.BACKEND_API_KEY = ""

    guardian_service._kill_switch_active = False
    guardian_service._kill_switch_reason = None
    guardian_service._triggered = False
    guardian_service._trigger_reason = None
    guardian_service._strategy_kill_switches = set()
    guardian_service._venue_kill_switches = set()
    guardian_service._reconciliation_drift_count = 0
    guardian_service._reconciliation_drift_reason = None

    app_module.BACKEND_API_KEY = ""
    app_module.TRADING_MODE = "paper"
    app_module.NETWORK = "testnet"
    app_module.EXCHANGE = "binance"
    app_module.PAPER_USE_LIVE_MARKET_DATA = False
    app_module.paper_portfolio.balances = {"USDT": 10000.0}
    app_module.paper_portfolio.open_orders = []
    app_module.paper_portfolio.filled_orders = []
    app_module.exchange_adapter = build_adapter(
        "paper",
        "testnet",
        app_module.paper_portfolio,
        _synthetic_price,
    )


def test_strategy_scope_can_be_activated_and_blocks_matching_strategy_intent():
    _reset_runtime_state()
    client = TestClient(app)

    response = client.post(
        "/kill-switch/scope",
        json={
            "scope_type": "strategy",
            "scope_id": "MomentumAlpha",
            "activate": True,
            "reason": "pause risky strategy",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["scope_type"] == "strategy"
    assert data["scope_id"] == "momentumalpha"
    assert data["active"] is True
    assert data["action"] == "activated"
    assert guardian_service.is_strategy_killed("MomentumAlpha") is True

    intent_response = client.post(
        "/intent/paper",
        json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": 0.001,
            "strategy_id": "MomentumAlpha",
        },
    )

    assert intent_response.status_code == 200
    assert intent_response.json()["status"] == "RISK_REJECTED"
    assert "kill-switched" in intent_response.json()["notes"]


def test_strategy_scope_can_be_deactivated():
    _reset_runtime_state()
    client = TestClient(app)

    client.post(
        "/kill-switch/scope",
        json={"scope_type": "strategy", "scope_id": "grid", "activate": True},
    )
    assert guardian_service.is_strategy_killed("grid") is True

    response = client.post(
        "/kill-switch/scope",
        json={"scope_type": "strategy", "scope_id": "grid", "activate": False},
    )

    assert response.status_code == 200
    assert response.json()["active"] is False
    assert response.json()["action"] == "deactivated"
    assert guardian_service.is_strategy_killed("grid") is False


def test_venue_scope_can_be_activated_and_blocks_matching_venue_intent():
    _reset_runtime_state()
    client = TestClient(app)

    response = client.post(
        "/kill-switch/scope",
        json={
            "scope_type": "venue",
            "scope_id": "Binance",
            "activate": True,
            "reason": "venue incident",
        },
    )

    assert response.status_code == 200
    assert response.json()["scope_id"] == "binance"
    assert response.json()["active"] is True
    assert guardian_service.is_venue_killed("Binance") is True

    intent_response = client.post(
        "/intent/paper",
        json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": 0.001,
            "venue_id": "Binance",
        },
    )

    assert intent_response.status_code == 200
    assert intent_response.json()["status"] == "RISK_REJECTED"
    assert "kill-switched" in intent_response.json()["notes"]


def test_scoped_kill_switch_requires_operator_key_when_auth_enabled():
    _reset_runtime_state()
    context_module.BACKEND_API_KEY = "operator-secret"
    app_module.BACKEND_API_KEY = "operator-secret"
    client = TestClient(app)

    blocked = client.post(
        "/kill-switch/scope",
        json={"scope_type": "strategy", "scope_id": "grid", "activate": True},
    )
    assert blocked.status_code == 401

    allowed = client.post(
        "/kill-switch/scope",
        headers={"X-API-Key": "operator-secret"},
        json={"scope_type": "strategy", "scope_id": "grid", "activate": True},
    )
    assert allowed.status_code == 200
    assert guardian_service.is_strategy_killed("grid") is True
