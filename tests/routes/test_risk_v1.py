# tests/routes/test_risk_v1.py
"""
Risk & Guardian V1 route tests — covers:
  POST /api/v1/risk/evaluate
  GET  /api/v1/guardian/status
  POST /api/v1/guardian/reset
  GET  /api/v1/guardian/thresholds
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from backend.services.risk_gate.service import RiskGateDecision


# ─── Shared fixtures ──────────────────────────────────────────────

@pytest.fixture()
def app():
    from backend.app import app as _app
    return _app


@pytest.fixture()
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_decision(**overrides) -> RiskGateDecision:
    defaults = dict(
        approved=True, order_qty=0.001, original_qty=0.001,
        size_multiplier=1.0, kill_switch=False,
        rules_passed=["MaxPosition", "Leverage"],
        rules_failed=[],
        reasons=["All rules passed"],
        risk_score=5.0,
        metadata={"account_balance": 10000.0},
    )
    defaults.update(overrides)
    return RiskGateDecision(**defaults)


def _make_guardian_status(**overrides):
    from backend.services.guardian_bot.service import GuardianStatus, GuardianThresholds
    thresholds = GuardianThresholds(
        max_drawdown_pct=10.0, max_daily_loss_pct=5.0,
        max_api_errors=5, max_failed_orders=3,
    )
    defaults = dict(
        kill_switch_active=False, triggered=False,
        kill_switch_reason=None, trigger_reason=None,
        drawdown_pct=0.0, daily_loss_pct=0.0,
        api_error_count=0, failed_order_count=0,
        thresholds=thresholds, market_data={},
        last_heartbeat_at=None, heartbeat_healthy=False,
        computed_at=1_700_000_000,
        reconciliation_drift_count=0,
        reconciliation_drift_active=False,
        in_cooldown=False, cooldown_remaining_s=0,
    )
    defaults.update(overrides)
    return GuardianStatus(**defaults)


# ─── POST /api/v1/risk/evaluate ──────────────────────────────────

class TestRiskEvaluate:
    @pytest.mark.asyncio
    async def test_approved_order_returns_200(self, client):
        with patch("backend.routes.risk_v1.evaluate_order",
                   new_callable=AsyncMock, return_value=_make_decision()):
            resp = await client.post("/api/v1/risk/evaluate", json={
                "symbol": "BTCUSDT", "side": "BUY", "qty": 0.001,
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["approved"] is True
        assert body["kill_switch"] is False
        assert body["rules_failed"] == []

    @pytest.mark.asyncio
    async def test_blocked_by_kill_switch(self, client):
        blocked = _make_decision(
            approved=False, order_qty=0.0, size_multiplier=0.0,
            kill_switch=True, rules_failed=["KillSwitch"],
            reasons=["Global kill switch is active"],
        )
        with patch("backend.routes.risk_v1.evaluate_order",
                   new_callable=AsyncMock, return_value=blocked):
            resp = await client.post("/api/v1/risk/evaluate", json={
                "symbol": "BTCUSDT", "side": "BUY", "qty": 0.001,
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["approved"] is False
        assert body["kill_switch"] is True
        assert "KillSwitch" in body["rules_failed"]

    @pytest.mark.asyncio
    async def test_blocked_by_cooldown(self, client):
        blocked = _make_decision(
            approved=False, order_qty=0.0, size_multiplier=0.0,
            kill_switch=False, rules_failed=["CooldownActive"],
            reasons=["Post-kill-switch cooldown active — 45s remaining"],
        )
        with patch("backend.routes.risk_v1.evaluate_order",
                   new_callable=AsyncMock, return_value=blocked):
            resp = await client.post("/api/v1/risk/evaluate", json={
                "symbol": "ETHUSDT", "side": "BUY", "qty": 0.01,
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["approved"] is False
        assert "CooldownActive" in body["rules_failed"]

    @pytest.mark.asyncio
    async def test_size_reduced_by_risk_rule(self, client):
        reduced = _make_decision(
            approved=True, order_qty=0.0007, size_multiplier=0.7,
            rules_passed=["MaxPosition", "Leverage"],
            reasons=["Position at 22%, reducing size"],
        )
        with patch("backend.routes.risk_v1.evaluate_order",
                   new_callable=AsyncMock, return_value=reduced):
            resp = await client.post("/api/v1/risk/evaluate", json={
                "symbol": "BTCUSDT", "side": "BUY", "qty": 0.001,
            })
        body = resp.json()
        assert body["approved"] is True
        assert body["size_multiplier"] < 1.0
        assert body["order_qty"] < body["original_qty"]

    @pytest.mark.asyncio
    async def test_invalid_side_returns_422(self, client):
        resp = await client.post("/api/v1/risk/evaluate", json={
            "symbol": "BTCUSDT", "side": "HOLD", "qty": 0.001,
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_zero_qty_returns_422(self, client):
        resp = await client.post("/api/v1/risk/evaluate", json={
            "symbol": "BTCUSDT", "side": "BUY", "qty": 0,
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_sell_passes_through(self, client):
        with patch("backend.routes.risk_v1.evaluate_order",
                   new_callable=AsyncMock, return_value=_make_decision()):
            resp = await client.post("/api/v1/risk/evaluate", json={
                "symbol": "BTCUSDT", "side": "SELL", "qty": 0.001,
            })
        assert resp.status_code == 200


# ─── GET /api/v1/guardian/status ─────────────────────────────────

class TestGuardianStatus:
    @pytest.mark.asyncio
    async def test_returns_expected_fields(self, client):
        with patch("backend.routes.risk_v1.get_guardian_status",
                   new_callable=AsyncMock, return_value=_make_guardian_status()):
            resp = await client.get("/api/v1/guardian/status")
        assert resp.status_code == 200
        body = resp.json()
        assert "kill_switch_active" in body
        assert "drawdown_pct" in body
        assert "thresholds" in body
        assert "in_cooldown" in body
        assert "cooldown_remaining_s" in body

    @pytest.mark.asyncio
    async def test_kill_switch_active_reflected(self, client):
        status = _make_guardian_status(
            kill_switch_active=True,
            kill_switch_reason="Max drawdown exceeded",
            triggered=True,
        )
        with patch("backend.routes.risk_v1.get_guardian_status",
                   new_callable=AsyncMock, return_value=status):
            resp = await client.get("/api/v1/guardian/status")
        body = resp.json()
        assert body["kill_switch_active"] is True
        assert body["triggered"] is True

    @pytest.mark.asyncio
    async def test_cooldown_reflected_in_status(self, client):
        status = _make_guardian_status(in_cooldown=True, cooldown_remaining_s=42)
        with patch("backend.routes.risk_v1.get_guardian_status",
                   new_callable=AsyncMock, return_value=status):
            resp = await client.get("/api/v1/guardian/status")
        body = resp.json()
        assert body["in_cooldown"] is True
        assert body["cooldown_remaining_s"] == 42

    @pytest.mark.asyncio
    async def test_thresholds_dict_has_required_keys(self, client):
        with patch("backend.routes.risk_v1.get_guardian_status",
                   new_callable=AsyncMock, return_value=_make_guardian_status()):
            resp = await client.get("/api/v1/guardian/status")
        thresholds = resp.json()["thresholds"]
        assert "max_drawdown_pct" in thresholds
        assert "max_api_errors" in thresholds
        assert "heartbeat_timeout_s" in thresholds


# ─── POST /api/v1/guardian/reset ─────────────────────────────────

class TestGuardianReset:
    @pytest.mark.asyncio
    async def test_counters_reset_without_deactivating_kill_switch(self, client):
        mock_status = _make_guardian_status(kill_switch_active=False)
        with (
            patch("backend.routes.risk_v1.get_guardian_status",
                  new_callable=AsyncMock, return_value=mock_status),
            patch("backend.routes.risk_v1.reset_counters") as mock_reset,
            patch("backend.routes.risk_v1.deactivate_kill_switch",
                  new_callable=AsyncMock) as mock_deactivate,
        ):
            resp = await client.post("/api/v1/guardian/reset",
                                     json={"deactivate_kill_switch": False})
        assert resp.status_code == 200
        body = resp.json()
        assert body["counters_reset"] is True
        assert body["kill_switch_was"] is False
        mock_reset.assert_called_once()
        mock_deactivate.assert_not_called()

    @pytest.mark.asyncio
    async def test_deactivate_kill_switch_when_requested(self, client):
        mock_before = _make_guardian_status(kill_switch_active=True)
        mock_after  = _make_guardian_status(kill_switch_active=False)
        with (
            patch("backend.routes.risk_v1.get_guardian_status",
                  new_callable=AsyncMock, side_effect=[mock_before, mock_after]),
            patch("backend.routes.risk_v1.reset_counters"),
            patch("backend.routes.risk_v1.deactivate_kill_switch",
                  new_callable=AsyncMock) as mock_deactivate,
        ):
            resp = await client.post("/api/v1/guardian/reset",
                                     json={"deactivate_kill_switch": True,
                                           "reason": "Operator cleared"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["kill_switch_was"] is True
        assert body["kill_switch_now"] is False
        mock_deactivate.assert_called_once_with(reason="Operator cleared")

    @pytest.mark.asyncio
    async def test_reset_with_custom_reason(self, client):
        mock_status = _make_guardian_status(kill_switch_active=False)
        with (
            patch("backend.routes.risk_v1.get_guardian_status",
                  new_callable=AsyncMock, return_value=mock_status),
            patch("backend.routes.risk_v1.reset_counters"),
            patch("backend.routes.risk_v1.deactivate_kill_switch",
                  new_callable=AsyncMock),
        ):
            resp = await client.post("/api/v1/guardian/reset",
                                     json={"reason": "Routine maintenance"})
        body = resp.json()
        assert body["reason"] == "Routine maintenance"


# ─── GET /api/v1/guardian/thresholds ─────────────────────────────

class TestGuardianThresholds:
    @pytest.mark.asyncio
    async def test_returns_threshold_keys(self, client):
        resp = await client.get("/api/v1/guardian/thresholds")
        assert resp.status_code == 200
        body = resp.json()
        assert "max_drawdown_pct" in body
        assert "max_api_errors" in body
        assert "max_failed_orders" in body
        assert "risk_tolerance" in body
        assert "position_size_fraction" in body

    @pytest.mark.asyncio
    async def test_threshold_values_are_positive(self, client):
        resp = await client.get("/api/v1/guardian/thresholds")
        body = resp.json()
        assert body["max_drawdown_pct"] > 0
        assert body["max_api_errors"] > 0
        assert body["max_failed_orders"] > 0


# ─── Unit: Guardian cooldown logic ───────────────────────────────

class TestCooldownLogic:
    def test_not_in_cooldown_initially(self):
        import backend.services.guardian_bot.service as svc
        svc._kill_switch_deactivated_at = None
        assert svc.is_in_cooldown() is False
        assert svc.cooldown_remaining_seconds() == 0

    def test_in_cooldown_right_after_deactivation(self):
        import time
        import backend.services.guardian_bot.service as svc
        svc._kill_switch_deactivated_at = int(time.time())
        assert svc.is_in_cooldown() is True
        assert svc.cooldown_remaining_seconds() > 0

    def test_cooldown_expires(self):
        import time
        import backend.services.guardian_bot.service as svc
        # Set deactivated_at to well past the cooldown window
        svc._kill_switch_deactivated_at = int(time.time()) - 9999
        assert svc.is_in_cooldown() is False
        assert svc.cooldown_remaining_seconds() == 0

    def test_cooldown_remaining_decreases_over_time(self):
        import time
        import backend.services.guardian_bot.service as svc
        svc._kill_switch_deactivated_at = int(time.time()) - 10
        remaining = svc.cooldown_remaining_seconds()
        cooldown_s = svc.get_cooldown_seconds()
        assert remaining == max(cooldown_s - 10, 0)


# ─── Unit: Risk gate cooldown integration ────────────────────────

class TestRiskGateCooldown:
    @pytest.mark.asyncio
    async def test_order_blocked_during_cooldown(self):
        from backend.services.risk_gate.service import evaluate_order

        with (
            patch("backend.services.guardian_bot.service.is_kill_switch_active",
                  new_callable=AsyncMock, return_value=False),
            patch("backend.services.guardian_bot.service.is_in_cooldown",
                  return_value=True),
            patch("backend.services.guardian_bot.service.cooldown_remaining_seconds",
                  return_value=55),
        ):
            decision = await evaluate_order("BTCUSDT", "BUY", 0.01, price=74000.0)

        assert decision.approved is False
        assert "CooldownActive" in decision.rules_failed
        assert "55s remaining" in decision.reasons[0]

    @pytest.mark.asyncio
    async def test_order_allowed_when_cooldown_expired(self):
        from backend.services.risk_gate.service import evaluate_order
        import backend.services.portfolio.service as port_svc
        from decimal import Decimal

        port_svc._cash = Decimal("10000")
        port_svc._lots.clear()
        port_svc._trades.clear()

        with (
            patch("backend.services.guardian_bot.service.is_kill_switch_active",
                  new_callable=AsyncMock, return_value=False),
            patch("backend.services.guardian_bot.service.is_in_cooldown",
                  return_value=False),
            patch("backend.services.guardian_bot.service.is_strategy_killed",
                  return_value=False),
            patch("backend.services.guardian_bot.service.is_venue_killed",
                  return_value=False),
            patch("backend.services.risk_gate.service._get_price_fn",
                  new_callable=AsyncMock,
                  return_value=MagicMock(price="74000", change24h="1.5")),
        ):
            decision = await evaluate_order("BTCUSDT", "BUY", 0.001, price=74000.0)

        assert "CooldownActive" not in decision.rules_failed
