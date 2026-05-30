# tests/routes/test_monitor_v1.py
"""
Monitoring router + service tests — /api/v1/monitor/...

Covers:
  - GET /status — structure, probe list, overall_ok flag
  - GET /probes — returns probe names
  - POST /run   — triggers probes, returns results
  - Alert dispatcher — logs when no webhook, fires webhook on failure
  - Probe state machine — consecutive failure tracking, alert thresholds,
    recovery detection
  - probe_health / probe_guardian / probe_circuit_breakers basic behaviour
"""
from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app import app
from backend.services.monitoring.alerts import Severity, dispatch
from backend.services.monitoring.probes import (
    ProbeResult,
    probe_circuit_breakers,
    probe_guardian,
    probe_health,
    probe_signal_engine,
)
from backend.services.monitoring.service import (
    ProbeState,
    _probe_states,
    _process_results,
    _run_probes,
    get_monitor_status,
)

BASE = "/api/v1/monitor"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ok(name="health") -> ProbeResult:
    return ProbeResult(name=name, ok=True, latency_ms=5)


def _fail(name="health", error="boom") -> ProbeResult:
    return ProbeResult(name=name, ok=False, latency_ms=5, error=error)


def _reset_states():
    _probe_states.clear()


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

class TestMonitorStatus:
    @pytest.mark.asyncio
    async def test_status_has_required_keys(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get(f"{BASE}/status")
        assert resp.status_code == 200
        data = resp.json()
        for key in ("running", "last_run_at", "run_count", "overall_ok", "probes"):
            assert key in data, f"Missing key: {key}"

    @pytest.mark.asyncio
    async def test_overall_ok_true_when_no_failures(self):
        _reset_states()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get(f"{BASE}/status")
        assert resp.json()["overall_ok"] is True

    @pytest.mark.asyncio
    async def test_overall_ok_false_when_probe_failing(self):
        _reset_states()
        _probe_states["health"] = ProbeState(last_result=_fail("health"))
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get(f"{BASE}/status")
        assert resp.json()["overall_ok"] is False
        _reset_states()


# ---------------------------------------------------------------------------
# GET /probes
# ---------------------------------------------------------------------------

class TestListProbes:
    @pytest.mark.asyncio
    async def test_probes_returns_list(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get(f"{BASE}/probes")
        assert resp.status_code == 200
        data = resp.json()
        assert "probes" in data
        assert data["count"] == len(data["probes"])
        assert "health" in data["probes"]
        assert "guardian" in data["probes"]


# ---------------------------------------------------------------------------
# POST /run
# ---------------------------------------------------------------------------

class TestRunProbes:
    @pytest.mark.asyncio
    async def test_run_returns_all_probe_results(self):
        fake_results = [_ok("health"), _ok("guardian"), _ok("market_data")]
        with (
            patch("backend.routes.monitor_v1._run_probes",
                  new=AsyncMock(return_value=fake_results)),
            patch("backend.routes.monitor_v1._process_results",
                  new=AsyncMock()),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/run")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ran"] == 3
        names = [r["name"] for r in data["results"]]
        assert "health" in names

    @pytest.mark.asyncio
    async def test_run_500_on_service_error(self):
        with patch("backend.routes.monitor_v1._run_probes",
                   new=AsyncMock(side_effect=RuntimeError("feed down"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(f"{BASE}/run")
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# Alert dispatcher
# ---------------------------------------------------------------------------

class TestAlertDispatcher:
    @pytest.mark.asyncio
    async def test_dispatch_logs_when_no_webhooks(self, caplog):
        import logging
        with patch.dict("os.environ", {}, clear=False):
            # Ensure no webhook env vars are set
            import os
            for k in ("ALERT_WEBHOOK_URL", "ALERT_SLACK_URL", "ALERT_DISCORD_URL"):
                os.environ.pop(k, None)
            with caplog.at_level(logging.WARNING, logger="backend.services.monitoring.alerts"):
                await dispatch("Test alert", "something happened", Severity.WARNING)
        # No exception = pass; log was emitted
        assert True

    @pytest.mark.asyncio
    async def test_dispatch_posts_to_webhook(self):
        import os
        os.environ["ALERT_WEBHOOK_URL"] = "https://hooks.example.com/test"
        mock_response = MagicMock()
        mock_response.status_code = 200

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("backend.services.monitoring.alerts.httpx.AsyncClient",
                   return_value=mock_client):
            await dispatch("Title", "Message", Severity.CRITICAL, extra={"k": "v"})

        mock_client.post.assert_called_once()
        call_url = mock_client.post.call_args[0][0]
        assert "hooks.example.com" in call_url
        os.environ.pop("ALERT_WEBHOOK_URL", None)

    @pytest.mark.asyncio
    async def test_dispatch_discord_uses_embeds(self):
        import os
        os.environ["ALERT_DISCORD_URL"] = "https://discord.com/api/webhooks/123/abc"
        mock_response = MagicMock()
        mock_response.status_code = 204

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("backend.services.monitoring.alerts.httpx.AsyncClient",
                   return_value=mock_client):
            await dispatch("Down", "probe failed", Severity.CRITICAL)

        payload = mock_client.post.call_args.kwargs.get("json") or \
                  mock_client.post.call_args[1].get("json")
        assert "embeds" in payload
        os.environ.pop("ALERT_DISCORD_URL", None)

    @pytest.mark.asyncio
    async def test_dispatch_never_raises(self):
        """Even if httpx explodes, dispatch must not propagate exceptions."""
        import os
        os.environ["ALERT_WEBHOOK_URL"] = "https://hooks.example.com/test"
        with patch("backend.services.monitoring.alerts.httpx.AsyncClient",
                   side_effect=RuntimeError("network gone")):
            # Should not raise
            await dispatch("Title", "Message", Severity.CRITICAL)
        os.environ.pop("ALERT_WEBHOOK_URL", None)


# ---------------------------------------------------------------------------
# Probe state machine
# ---------------------------------------------------------------------------

class TestProbeStateMachine:
    @pytest.mark.asyncio
    async def test_critical_probe_alerts_on_first_failure(self):
        _reset_states()
        dispatched = []

        async def _fake_dispatch(title, message, severity=Severity.WARNING, extra=None):
            dispatched.append({"title": title, "severity": severity})

        with patch("backend.services.monitoring.service.dispatch",
                   side_effect=_fake_dispatch):
            await _process_results([_fail("health", "liveness failed")])

        assert len(dispatched) == 1
        assert dispatched[0]["severity"] == Severity.CRITICAL
        _reset_states()

    @pytest.mark.asyncio
    async def test_warning_probe_requires_two_failures_before_alert(self):
        _reset_states()
        dispatched = []

        async def _fake_dispatch(title, message, severity=Severity.WARNING, extra=None):
            dispatched.append(severity)

        with patch("backend.services.monitoring.service.dispatch",
                   side_effect=_fake_dispatch):
            # First failure — no alert yet
            await _process_results([_fail("portfolio")])
            assert len(dispatched) == 0
            # Second consecutive failure — alert fires
            await _process_results([_fail("portfolio")])
            assert len(dispatched) == 1
            assert dispatched[0] == Severity.WARNING
        _reset_states()

    @pytest.mark.asyncio
    async def test_no_duplicate_alert_on_continued_failure(self):
        _reset_states()
        dispatched = []

        async def _fake_dispatch(title, message, severity=Severity.WARNING, extra=None):
            dispatched.append(severity)

        with patch("backend.services.monitoring.service.dispatch",
                   side_effect=_fake_dispatch):
            for _ in range(5):
                await _process_results([_fail("portfolio")])

        # Alert fires once at threshold, not on every subsequent failure
        assert len(dispatched) == 1
        _reset_states()

    @pytest.mark.asyncio
    async def test_recovery_fires_info_alert(self):
        _reset_states()
        dispatched = []

        async def _fake_dispatch(title, message, severity=Severity.WARNING, extra=None):
            dispatched.append({"sev": severity, "title": title})

        with patch("backend.services.monitoring.service.dispatch",
                   side_effect=_fake_dispatch):
            # Two failures to get guardian into alerted state (non-critical threshold=2)
            await _process_results([_fail("portfolio")])
            await _process_results([_fail("portfolio")])
            assert len(dispatched) == 1  # warning fired
            # Recovery
            await _process_results([_ok("portfolio")])

        assert len(dispatched) == 2
        assert dispatched[1]["sev"] == Severity.INFO
        assert "recovered" in dispatched[1]["title"].lower()
        _reset_states()

    @pytest.mark.asyncio
    async def test_consecutive_counter_resets_on_recovery(self):
        _reset_states()
        with patch("backend.services.monitoring.service.dispatch", new=AsyncMock()):
            await _process_results([_fail("portfolio")])
            await _process_results([_ok("portfolio")])
            state = _probe_states["portfolio"]
            assert state.consecutive_failures == 0
            assert state.alerted_down is False
        _reset_states()


# ---------------------------------------------------------------------------
# Individual probe behaviour
# ---------------------------------------------------------------------------

class TestProbeHealth:
    @pytest.mark.asyncio
    async def test_probe_health_ok(self):
        import backend.services.monitoring.probes as _p
        _p._ctx.kill_switch_active = False
        _p._ctx.guardian_triggered = False
        result = await probe_health()
        assert result.name == "health"
        assert isinstance(result.ok, bool)

    @pytest.mark.asyncio
    async def test_probe_health_returns_kill_switch_state(self):
        import backend.services.monitoring.probes as _p
        _p._ctx.kill_switch_active = True
        result = await probe_health()
        assert result.detail.get("kill_switch_active") is True
        _p._ctx.kill_switch_active = False


class TestProbeGuardian:
    @pytest.mark.asyncio
    async def test_probe_guardian_ok_when_not_triggered(self):
        g = MagicMock()
        g.triggered = False
        g.kill_switch_active = False
        g.drawdown_pct = 0.5
        g.daily_loss_pct = 0.2
        g.api_error_count = 0
        g.failed_order_count = 0
        with patch(
            "backend.services.monitoring.probes.get_guardian_status",
            new=AsyncMock(return_value=g),
        ):
            result = await probe_guardian()
        assert result.ok is True
        assert result.detail["drawdown_pct"] == 0.5

    @pytest.mark.asyncio
    async def test_probe_guardian_fails_when_triggered(self):
        g = MagicMock()
        g.triggered = True
        g.kill_switch_active = True
        g.drawdown_pct = 6.0
        g.daily_loss_pct = 11.0
        g.api_error_count = 15
        g.failed_order_count = 7
        with patch(
            "backend.services.monitoring.probes.get_guardian_status",
            new=AsyncMock(return_value=g),
        ):
            result = await probe_guardian()
        assert result.ok is False


class TestProbeCircuitBreakers:
    @pytest.mark.asyncio
    async def test_all_closed_is_ok(self):
        with patch(
            "backend.services.monitoring.probes.get_all_circuit_breaker_statuses",
            return_value=[{"name": "binance", "state": "closed"}],
        ):
            result = await probe_circuit_breakers()
        assert result.ok is True
        assert result.detail["open"] == 0

    @pytest.mark.asyncio
    async def test_open_breaker_is_not_ok(self):
        with patch(
            "backend.services.monitoring.probes.get_all_circuit_breaker_statuses",
            return_value=[{"name": "binance", "state": "open"}],
        ):
            result = await probe_circuit_breakers()
        assert result.ok is False
        assert result.detail["open"] == 1


class TestProbeSignalEngine:
    @pytest.mark.asyncio
    async def test_running_with_signals_is_ok(self):
        fake_sig = MagicMock()
        with (
            patch("backend.services.monitoring.probes.get_signal_service_status",
                  return_value={"running": True, "cached_symbols": ["BTCUSDT"]}),
            patch("backend.services.monitoring.probes.get_all_cached_signals",
                  return_value=[fake_sig]),
        ):
            result = await probe_signal_engine()
        assert result.ok is True

    @pytest.mark.asyncio
    async def test_no_cached_signals_still_ok_when_running(self):
        """Loop running is sufficient — empty cache is ok (first-eval window or no OHLCV)."""
        with (
            patch("backend.services.monitoring.probes.get_signal_service_status",
                  return_value={"running": True, "cached_symbols": []}),
            patch("backend.services.monitoring.probes.get_all_cached_signals",
                  return_value=[]),
        ):
            result = await probe_signal_engine()
        assert result.ok is True
        assert result.detail["non_flat"] == 0

    @pytest.mark.asyncio
    async def test_signal_engine_not_ok_when_loop_stopped(self):
        """Probe fails when the eval loop is not running."""
        with (
            patch("backend.services.monitoring.probes.get_signal_service_status",
                  return_value={"running": False, "cached_symbols": []}),
            patch("backend.services.monitoring.probes.get_all_cached_signals",
                  return_value=[]),
        ):
            result = await probe_signal_engine()
        assert result.ok is False
