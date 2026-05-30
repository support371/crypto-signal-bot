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



# ---------------------------------------------------------------------------
# Phase 4 helpers
# ---------------------------------------------------------------------------

_CLOSE_POS   = "backend.routes.console_v1.close_position"
_CLOSE_ALL   = "backend.routes.console_v1.close_all_positions"
_CANCEL_ORD  = "backend.routes.console_v1.cancel_pending_order"
_GET_RT      = "backend.routes.console_v1.get_runtime_thresholds"
_SET_RT      = "backend.routes.console_v1.set_runtime_thresholds"
_RESET_RT    = "backend.routes.console_v1.reset_runtime_thresholds"


def _close_result(symbol="BTCUSDT", qty=0.1, status="FILLED"):
    return {
        "order_id":   str(uuid.uuid4()),
        "symbol":     symbol,
        "qty_closed": qty,
        "status":     status,
        "created_at": int(time.time()),
    }


def _rt_thresholds(overridden=False):
    return {
        "max_drawdown_pct":   10.0,
        "max_daily_loss_pct": 5.0,
        "max_api_errors":     10,
        "max_failed_orders":  5,
        "overridden":         overridden,
    }


# ---------------------------------------------------------------------------
# POST /positions/close
# ---------------------------------------------------------------------------

class TestClosePosition:
    @pytest.mark.asyncio
    async def test_closes_open_position(self):
        with patch(_CLOSE_POS, new_callable=AsyncMock,
                   return_value=_close_result("BTCUSDT")):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/positions/close", json={"symbol": "BTCUSDT"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["symbol"] == "BTCUSDT"
        assert body["qty_closed"] > 0
        assert "order_id" in body

    @pytest.mark.asyncio
    async def test_returns_404_when_no_position(self):
        with patch(_CLOSE_POS, new_callable=AsyncMock, return_value=None):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/positions/close", json={"symbol": "ETHUSDT"})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_symbol_uppercased(self):
        with patch(_CLOSE_POS, new_callable=AsyncMock,
                   return_value=_close_result("SOLUSDT")) as mock_fn:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                await c.post(f"{BASE}/positions/close", json={"symbol": "solusdt"})
        mock_fn.assert_called_once_with("SOLUSDT")


# ---------------------------------------------------------------------------
# POST /positions/close-all
# ---------------------------------------------------------------------------

class TestCloseAllPositions:
    @pytest.mark.asyncio
    async def test_closes_multiple_positions(self):
        results = [_close_result("BTCUSDT"), _close_result("ETHUSDT")]
        with patch(_CLOSE_ALL, new_callable=AsyncMock, return_value=results):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/positions/close-all")
        assert resp.status_code == 200
        body = resp.json()
        assert body["closed"] == 2
        assert len(body["results"]) == 2
        assert "ts" in body

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_positions(self):
        with patch(_CLOSE_ALL, new_callable=AsyncMock, return_value=[]):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/positions/close-all")
        assert resp.status_code == 200
        assert resp.json()["closed"] == 0


# ---------------------------------------------------------------------------
# POST /positions/cancel-order
# ---------------------------------------------------------------------------

class TestCancelOrder:
    @pytest.mark.asyncio
    async def test_cancels_pending_order(self):
        with patch(_CANCEL_ORD, return_value=True):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/positions/cancel-order",
                                    json={"order_id": "abc123"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["cancelled"] is True
        assert body["order_id"] == "abc123"

    @pytest.mark.asyncio
    async def test_returns_404_for_unknown_order(self):
        with patch(_CANCEL_ORD, return_value=False):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/positions/cancel-order",
                                    json={"order_id": "nonexistent"})
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /guardian/thresholds
# ---------------------------------------------------------------------------

class TestUpdateThresholds:
    @pytest.mark.asyncio
    async def test_update_single_threshold(self):
        updated = _rt_thresholds(overridden=True)
        updated["max_drawdown_pct"] = 7.5
        with patch(_SET_RT, return_value=updated):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/guardian/thresholds",
                                    json={"max_drawdown_pct": 7.5})
        assert resp.status_code == 200
        body = resp.json()
        assert body["updated"] is True
        assert body["thresholds"]["max_drawdown_pct"] == 7.5

    @pytest.mark.asyncio
    async def test_update_multiple_thresholds(self):
        with patch(_SET_RT, return_value=_rt_thresholds(overridden=True)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/guardian/thresholds",
                                    json={"max_drawdown_pct": 8.0, "max_api_errors": 15})
        assert resp.status_code == 200
        assert resp.json()["updated"] is True

    @pytest.mark.asyncio
    async def test_reset_to_defaults(self):
        defaults = _rt_thresholds(overridden=False)
        with patch(_RESET_RT, return_value=defaults):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/guardian/thresholds",
                                    json={"reset_to_defaults": True})
        assert resp.status_code == 200
        body = resp.json()
        assert body["reset"] is True
        assert body["updated"] is False
        assert body["thresholds"]["overridden"] is False

    @pytest.mark.asyncio
    async def test_empty_update_returns_422(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post(f"{BASE}/guardian/thresholds", json={})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_drawdown_pct_returns_422(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post(f"{BASE}/guardian/thresholds",
                                json={"max_drawdown_pct": 150.0})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_zero_max_api_errors_returns_422(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post(f"{BASE}/guardian/thresholds",
                                json={"max_api_errors": 0})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /guardian/thresholds
# ---------------------------------------------------------------------------

class TestGetThresholds:
    @pytest.mark.asyncio
    async def test_returns_threshold_fields(self):
        with patch(_GET_RT, return_value=_rt_thresholds()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get(f"{BASE}/guardian/thresholds")
        assert resp.status_code == 200
        body = resp.json()
        for key in ("max_drawdown_pct", "max_daily_loss_pct",
                    "max_api_errors", "max_failed_orders", "overridden"):
            assert key in body

    @pytest.mark.asyncio
    async def test_overridden_flag_false_by_default(self):
        with patch(_GET_RT, return_value=_rt_thresholds(overridden=False)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.get(f"{BASE}/guardian/thresholds")
        assert resp.json()["overridden"] is False


# ---------------------------------------------------------------------------
# Unit: Guardian runtime threshold functions
# ---------------------------------------------------------------------------

class TestGuardianRuntimeThresholds:
    def setup_method(self):
        import backend.services.guardian_bot.service as svc
        svc._rt_max_drawdown_pct   = None
        svc._rt_max_daily_loss_pct = None
        svc._rt_max_api_errors     = None
        svc._rt_max_failed_orders  = None

    def test_get_returns_config_defaults_when_no_overrides(self):
        from backend.services.guardian_bot.service import get_runtime_thresholds
        t = get_runtime_thresholds()
        assert t["max_drawdown_pct"] > 0
        assert t["overridden"] is False

    def test_set_single_override(self):
        from backend.services.guardian_bot.service import (
            set_runtime_thresholds, get_runtime_thresholds
        )
        set_runtime_thresholds(max_drawdown_pct=7.5)
        t = get_runtime_thresholds()
        assert t["max_drawdown_pct"] == 7.5
        assert t["overridden"] is True

    def test_set_all_overrides(self):
        from backend.services.guardian_bot.service import (
            set_runtime_thresholds, get_runtime_thresholds
        )
        set_runtime_thresholds(
            max_drawdown_pct=8.0, max_daily_loss_pct=4.0,
            max_api_errors=12, max_failed_orders=6,
        )
        t = get_runtime_thresholds()
        assert t["max_drawdown_pct"] == 8.0
        assert t["max_daily_loss_pct"] == 4.0
        assert t["max_api_errors"] == 12
        assert t["max_failed_orders"] == 6
        assert t["overridden"] is True

    def test_reset_clears_all_overrides(self):
        from backend.services.guardian_bot.service import (
            set_runtime_thresholds, reset_runtime_thresholds, get_runtime_thresholds
        )
        set_runtime_thresholds(max_drawdown_pct=5.0)
        reset_runtime_thresholds()
        t = get_runtime_thresholds()
        assert t["overridden"] is False

    def test_invalid_drawdown_raises_value_error(self):
        from backend.services.guardian_bot.service import set_runtime_thresholds
        with pytest.raises(ValueError):
            set_runtime_thresholds(max_drawdown_pct=0)
        with pytest.raises(ValueError):
            set_runtime_thresholds(max_drawdown_pct=101)

    def test_invalid_api_errors_raises_value_error(self):
        from backend.services.guardian_bot.service import set_runtime_thresholds
        with pytest.raises(ValueError):
            set_runtime_thresholds(max_api_errors=0)
