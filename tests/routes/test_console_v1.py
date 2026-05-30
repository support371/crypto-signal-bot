# tests/routes/test_console_v1.py
"""
Command Console router tests — /api/v1/console/...

Covers:
  - GET  /status          — structure and field presence
  - GET  /audit           — returns list, respects limit
  - POST /trade           — normal path, kill switch path, signal gate path,
                            force bypass, risk gate denial
  - POST /signal-override — sets override, expiry fields present
  - DEL  /signal-override — cancels override
  - POST /signal-reeval   — single symbol, all symbols, service error
  - POST /kill-switch     — activate + deactivate
  - POST /guardian/reset  — confirm=True / False
  - GET  /guardian/status — field completeness
"""
from __future__ import annotations

import time
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app import app
from backend.engine.coordinator import (
    KillSwitchActive,
    RiskGateDenied,
    SignalGateDenied,
)
from backend.engine.routing import ExecutionFailed
from backend.logic.signal_engine import SignalRecord

BASE = "/api/v1/console"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _signal(side="BUY", symbol="BTCUSDT"):
    now = int(time.time())
    return SignalRecord(
        id=str(uuid.uuid4()), symbol=symbol, timeframe="1h",
        side=side, entry_price=50000.0,
        stop_loss=49000.0, take_profit=52000.0,
        confidence=0.75, strategy_id="combined",
        created_at=now, valid_until=now + 900, metadata={},
    )


def _fake_result(status="FILLED"):
    r = MagicMock()
    r.order_id = str(uuid.uuid4())
    r.status = status
    r.fill_price = Decimal("50000")
    r.filled_qty = Decimal("0.01")
    r.venue = "paper"
    r.realized_pnl = None
    r.elapsed_ms = 12
    return r


_GUARDIAN = "backend.routes.console_v1.get_guardian_status"
_PORTFOLIO = "backend.routes.console_v1.get_portfolio_summary"
_SIGNALS = "backend.routes.console_v1.get_all_cached_signals"
_SIG_STATUS = "backend.routes.console_v1.get_signal_service_status"
_EXECUTE = "backend.routes.console_v1.execute_intent"
_EVAL = "backend.routes.console_v1.evaluate_signal"
_AUDIT_ENTRIES = "backend.routes.console_v1.get_recent_entries"
_KS_ACTIVATE = "backend.routes.console_v1.activate_kill_switch"
_KS_DEACTIVATE = "backend.routes.console_v1.deactivate_kill_switch"
_KS_AUDIT_ON = "backend.routes.console_v1.append_kill_switch_manual"
_KS_AUDIT_OFF = "backend.routes.console_v1.append_kill_switch_deactivate"
_RESET = "backend.routes.console_v1.reset_counters"


def _guardian_mock(kill_switch=False):
    g = MagicMock()
    g.kill_switch_active = kill_switch
    g.triggered = False
    g.kill_switch_reason = None
    g.trigger_reason = None
    g.drawdown_pct = 0.0
    g.daily_loss_pct = 0.0
    g.api_error_count = 0
    g.failed_order_count = 0
    g.last_heartbeat_at = int(time.time())
    g.market_data = {"connected": True}
    g.computed_at = int(time.time())
    g.thresholds = MagicMock(
        max_drawdown_pct=5.0,
        max_daily_loss_pct=10.0,
        max_api_errors=10,
        max_failed_orders=5,
    )
    return g


def _portfolio_mock():
    return {
        "cash_balance": 10000.0,
        "equity": 10500.0,
        "drawdown_pct": 0.0,
        "trade_count": 3,
        "win_rate": 66.7,
        "positions": [],
    }


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

class TestStatus:
    @pytest.mark.asyncio
    async def test_status_returns_expected_keys(self):
        with (
            patch(_GUARDIAN,   new=AsyncMock(return_value=_guardian_mock())),
            patch(_PORTFOLIO,  new=AsyncMock(return_value=_portfolio_mock())),
            patch(_SIGNALS,    return_value=[_signal()]),
            patch(_SIG_STATUS, return_value={"running": True, "cached_symbols": ["BTCUSDT"],
                                              "tracked_symbols": 1, "eval_interval": 60,
                                              "last_eval": {}}),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get(f"{BASE}/status")

        assert resp.status_code == 200
        data = resp.json()
        assert "guardian"  in data
        assert "portfolio" in data
        assert "signals"   in data
        assert "market"    in data
        assert "ts"        in data

    @pytest.mark.asyncio
    async def test_status_signal_list(self):
        with (
            patch(_GUARDIAN,   new=AsyncMock(return_value=_guardian_mock())),
            patch(_PORTFOLIO,  new=AsyncMock(return_value=_portfolio_mock())),
            patch(_SIGNALS,    return_value=[_signal("BUY"), _signal("FLAT", "ETHUSDT")]),
            patch(_SIG_STATUS, return_value={"running": True, "cached_symbols": [],
                                              "tracked_symbols": 2, "eval_interval": 60,
                                              "last_eval": {}}),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get(f"{BASE}/status")

        symbols = [s["symbol"] for s in resp.json()["signals"]["symbols"]]
        assert "BTCUSDT" in symbols
        assert "ETHUSDT" in symbols


# ---------------------------------------------------------------------------
# GET /audit
# ---------------------------------------------------------------------------

class TestAudit:
    @pytest.mark.asyncio
    async def test_audit_returns_entries(self):
        fake_entry = MagicMock()
        fake_entry.__dict__ = {"id": "abc", "event_type": "kill_switch", "ts": 1}
        with patch(_AUDIT_ENTRIES, return_value=[fake_entry]):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get(f"{BASE}/audit")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    @pytest.mark.asyncio
    async def test_audit_limit_capped_at_500(self):
        with patch(_AUDIT_ENTRIES, return_value=[]) as mock:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                await c.get(f"{BASE}/audit?limit=9999")
        mock.assert_called_once_with(500)


# ---------------------------------------------------------------------------
# POST /trade
# ---------------------------------------------------------------------------

class TestTrade:
    @pytest.mark.asyncio
    async def test_trade_happy_path(self):
        fake = _fake_result("FILLED")
        with patch(_EXECUTE, new=AsyncMock(return_value=fake)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/trade", json={
                    "symbol": "BTCUSDT", "side": "BUY",
                    "quantity": "0.01", "mode": "paper",
                })
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "FILLED"
        assert data["signal_gate_bypassed"] is False

    @pytest.mark.asyncio
    async def test_trade_kill_switch_503(self):
        with patch(_EXECUTE, new=AsyncMock(side_effect=KillSwitchActive("halted"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/trade", json={
                    "symbol": "BTCUSDT", "side": "BUY", "quantity": "0.01",
                })
        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_trade_risk_gate_409(self):
        with patch(_EXECUTE, new=AsyncMock(side_effect=RiskGateDenied("drawdown exceeded"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/trade", json={
                    "symbol": "BTCUSDT", "side": "BUY", "quantity": "0.01",
                })
        assert resp.status_code == 409
        assert "drawdown exceeded" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_trade_signal_gate_409(self):
        with patch(_EXECUTE, new=AsyncMock(
            side_effect=SignalGateDenied("signal=FLAT, intent=BUY")
        )):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/trade", json={
                    "symbol": "BTCUSDT", "side": "BUY", "quantity": "0.01",
                })
        assert resp.status_code == 409
        assert "Signal gate" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_trade_force_bypass_sets_and_consumes_override(self):
        """force=True must set the override and mark it consumed in the response."""
        from backend.engine.signal_override import _signal_overrides
        _signal_overrides.clear()

        fake = _fake_result("FILLED")
        with patch(_EXECUTE, new=AsyncMock(return_value=fake)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/trade", json={
                    "symbol": "BTCUSDT", "side": "BUY",
                    "quantity": "0.01", "force": True,
                })
        assert resp.status_code == 201
        # Override should be consumed (one-shot) after successful trade
        assert resp.json()["signal_gate_bypassed"] is True
        assert "BTCUSDT" not in _signal_overrides

    @pytest.mark.asyncio
    async def test_trade_execution_failed_502(self):
        with patch(_EXECUTE, new=AsyncMock(side_effect=ExecutionFailed("adapter error"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/trade", json={
                    "symbol": "BTCUSDT", "side": "BUY", "quantity": "0.01",
                })
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# POST /signal-override
# ---------------------------------------------------------------------------

class TestSignalOverride:
    @pytest.mark.asyncio
    async def test_set_override_returns_expiry(self):
        from backend.engine.signal_override import _signal_overrides
        _signal_overrides.clear()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post(f"{BASE}/signal-override",
                                json={"symbol": "BTCUSDT", "ttl_seconds": 120})
        assert resp.status_code == 200
        data = resp.json()
        assert data["override"] is True
        assert data["symbol"] == "BTCUSDT"
        assert data["expires_at"] > int(time.time())
        assert "BTCUSDT" in _signal_overrides

    @pytest.mark.asyncio
    async def test_cancel_override(self):
        from backend.engine.signal_override import _signal_overrides
        _signal_overrides["ETHUSDT"] = int(time.time()) + 300

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.delete(f"{BASE}/signal-override/ETHUSDT")
        assert resp.status_code == 200
        data = resp.json()
        assert data["removed"] is True
        assert "ETHUSDT" not in _signal_overrides

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_override(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.delete(f"{BASE}/signal-override/SOLUSDT")
        assert resp.status_code == 200
        assert resp.json()["removed"] is False


# ---------------------------------------------------------------------------
# POST /signal-reeval
# ---------------------------------------------------------------------------

class TestSignalReeval:
    @pytest.mark.asyncio
    async def test_reeval_single_symbol(self):
        fake = _signal("BUY", "BTCUSDT")
        with patch(_EVAL, new=AsyncMock(return_value=fake)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/signal-reeval", json={"symbol": "BTCUSDT"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["evaluated"] == 1
        assert data["results"][0]["symbol"] == "BTCUSDT"
        assert data["results"][0]["side"] == "BUY"

    @pytest.mark.asyncio
    async def test_reeval_all_symbols(self):
        fake = _signal("FLAT", "BTCUSDT")
        with (
            patch(_EVAL, new=AsyncMock(return_value=fake)),
            patch("backend.routes.console_v1._SYMBOLS", {"BTCUSDT"}, create=True),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/signal-reeval", json={})
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_reeval_service_error_captured(self):
        with patch(_EVAL, new=AsyncMock(side_effect=RuntimeError("feed down"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/signal-reeval", json={"symbol": "BTCUSDT"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["evaluated"] == 0
        assert data["errors"][0]["error"] == "feed down"


# ---------------------------------------------------------------------------
# POST /kill-switch
# ---------------------------------------------------------------------------

class TestKillSwitch:
    @pytest.mark.asyncio
    async def test_activate(self):
        with (
            patch(_KS_ACTIVATE,  new=AsyncMock()),
            patch(_KS_AUDIT_ON,  new=AsyncMock()),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/kill-switch",
                                    json={"activate": True, "reason": "test halt"})
        assert resp.status_code == 200
        assert resp.json()["kill_switch_active"] is True
        assert resp.json()["action"] == "activated"

    @pytest.mark.asyncio
    async def test_deactivate(self):
        with (
            patch(_KS_DEACTIVATE, new=AsyncMock()),
            patch(_KS_AUDIT_OFF,  new=AsyncMock()),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/kill-switch",
                                    json={"activate": False})
        assert resp.status_code == 200
        assert resp.json()["kill_switch_active"] is False
        assert resp.json()["action"] == "deactivated"


# ---------------------------------------------------------------------------
# POST /guardian/reset
# ---------------------------------------------------------------------------

class TestGuardianReset:
    @pytest.mark.asyncio
    async def test_reset_confirm_true(self):
        with patch(_RESET):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/guardian/reset", json={"confirm": True})
        assert resp.status_code == 200
        assert resp.json()["reset"] is True

    @pytest.mark.asyncio
    async def test_reset_confirm_false_returns_400(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post(f"{BASE}/guardian/reset", json={"confirm": False})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /guardian/status
# ---------------------------------------------------------------------------

class TestGuardianStatus:
    @pytest.mark.asyncio
    async def test_guardian_status_has_expected_fields(self):
        with patch(_GUARDIAN, new=AsyncMock(return_value=_guardian_mock())):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get(f"{BASE}/guardian/status")
        assert resp.status_code == 200
        data = resp.json()
        for key in ("kill_switch_active", "drawdown_pct", "api_error_count",
                    "thresholds", "computed_at"):
            assert key in data, f"Missing key: {key}"
