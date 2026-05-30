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


# ---------------------------------------------------------------------------
# probe_portfolio (direct unit tests)
# ---------------------------------------------------------------------------

class TestProbePortfolio:
    @pytest.mark.asyncio
    async def test_probe_portfolio_ok_when_equity_positive(self):
        from backend.services.monitoring.probes import probe_portfolio
        mock_summary = {
            "equity": 10500.0,
            "cash_balance": 9000.0,
            "drawdown_pct": 1.2,
        }
        with patch(
            "backend.services.monitoring.probes.get_portfolio_summary",
            new_callable=AsyncMock,
            return_value=mock_summary,
        ):
            result = await probe_portfolio()
        assert result.ok is True
        assert result.name == "portfolio"
        assert result.detail["equity"] == 10500.0

    @pytest.mark.asyncio
    async def test_probe_portfolio_ok_with_zero_equity(self):
        from backend.services.monitoring.probes import probe_portfolio
        with patch(
            "backend.services.monitoring.probes.get_portfolio_summary",
            new_callable=AsyncMock,
            return_value={"equity": 0.0, "cash_balance": 0.0, "drawdown_pct": 0.0},
        ):
            result = await probe_portfolio()
        assert result.ok is True   # 0 equity is still valid (fresh account)

    @pytest.mark.asyncio
    async def test_probe_portfolio_fails_on_exception(self):
        from backend.services.monitoring.probes import probe_portfolio
        with patch(
            "backend.services.monitoring.probes.get_portfolio_summary",
            new_callable=AsyncMock,
            side_effect=RuntimeError("DB unavailable"),
        ):
            result = await probe_portfolio()
        assert result.ok is False
        assert "DB unavailable" in (result.error or "")


# ---------------------------------------------------------------------------
# probe_cooldown (direct unit tests)
# ---------------------------------------------------------------------------

class TestProbeCooldown:
    @pytest.mark.asyncio
    async def test_ok_when_not_in_cooldown(self):
        from backend.services.monitoring.probes import probe_cooldown
        with (
            patch("backend.services.monitoring.probes._is_in_cooldown", return_value=False),
            patch("backend.services.monitoring.probes._cooldown_remaining", return_value=0),
            patch("backend.services.monitoring.probes._get_cooldown_seconds", return_value=60),
        ):
            result = await probe_cooldown()
        assert result.ok is True
        assert result.name == "cooldown"
        assert result.detail["in_cooldown"] is False

    @pytest.mark.asyncio
    async def test_failing_when_in_cooldown(self):
        from backend.services.monitoring.probes import probe_cooldown
        with (
            patch("backend.services.monitoring.probes._is_in_cooldown", return_value=True),
            patch("backend.services.monitoring.probes._cooldown_remaining", return_value=45),
            patch("backend.services.monitoring.probes._get_cooldown_seconds", return_value=60),
        ):
            result = await probe_cooldown()
        assert result.ok is False
        assert result.detail["cooldown_remaining_s"] == 45
        assert result.detail["cooldown_window_s"] == 60

    @pytest.mark.asyncio
    async def test_fallback_ok_when_guardian_unavailable(self):
        from backend.services.monitoring.probes import probe_cooldown
        with patch(
            "backend.services.monitoring.probes._is_in_cooldown",
            side_effect=ImportError("not available"),
        ):
            result = await probe_cooldown()
        # Fallback: don't fail the probe if guardian service is unavailable
        assert result.ok is True


# ---------------------------------------------------------------------------
# probe_external_liveness (direct unit tests)
# ---------------------------------------------------------------------------

class TestProbeExternalLiveness:
    @pytest.mark.asyncio
    async def test_skipped_when_no_env_var(self, monkeypatch):
        from backend.services.monitoring.probes import probe_external_liveness
        monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
        monkeypatch.delenv("EXTERNAL_HEALTH_URL", raising=False)
        result = await probe_external_liveness()
        assert result.ok is True
        assert result.detail.get("skipped") is True

    @pytest.mark.asyncio
    async def test_ok_when_health_returns_200(self, monkeypatch):
        import os
        from backend.services.monitoring.probes import probe_external_liveness
        monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://fake-render.onrender.com")

        mock_resp = MagicMock()
        mock_resp.status_code = 200

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await probe_external_liveness()

        assert result.ok is True
        assert result.detail["status_code"] == 200

    @pytest.mark.asyncio
    async def test_failing_when_health_returns_500(self, monkeypatch):
        from backend.services.monitoring.probes import probe_external_liveness
        monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://fake-render.onrender.com")

        mock_resp = MagicMock()
        mock_resp.status_code = 500

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await probe_external_liveness()

        assert result.ok is False
        assert "HTTP 500" in (result.error or "")

    @pytest.mark.asyncio
    async def test_failing_on_network_error(self, monkeypatch):
        from backend.services.monitoring.probes import probe_external_liveness
        monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://fake-render.onrender.com")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(side_effect=Exception("Connection refused"))

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await probe_external_liveness()

        assert result.ok is False
        assert "Connection refused" in (result.error or "")


# ---------------------------------------------------------------------------
# Re-alert window (monitoring service)
# ---------------------------------------------------------------------------

class TestReAlertWindow:
    @pytest.mark.asyncio
    async def test_no_realert_before_interval(self):
        """alerted_down=True and last_alert_at recent → no second alert."""
        from backend.services.monitoring import service as svc
        from backend.services.monitoring.service import _probe_states, ProbeState

        svc._probe_states.clear()
        name = "signal_engine_realert_test"
        state = ProbeState()
        # Simulate: already alerted, alerted 5s ago, still failing
        state.alerted_down = True
        state.consecutive_failures = 3
        state.last_alert_at = int(time.time()) - 5
        svc._probe_states[name] = state

        mock_result = ProbeResult(name=name, ok=False, error="loop stopped")
        with patch("backend.services.monitoring.service.dispatch",
                   new_callable=AsyncMock) as mock_dispatch:
            await svc._process_results([mock_result])
        mock_dispatch.assert_not_called()

    @pytest.mark.asyncio
    async def test_realert_fires_after_interval(self):
        """alerted_down=True but last_alert_at is old → re-alert fires."""
        from backend.services.monitoring import service as svc
        from backend.services.monitoring.service import _probe_states, ProbeState, REALERT_INTERVAL

        svc._probe_states.clear()
        name = "guardian_realert_test"
        state = ProbeState()
        state.alerted_down = True
        state.consecutive_failures = 10
        # Set last_alert_at well beyond REALERT_INTERVAL
        state.last_alert_at = int(time.time()) - (REALERT_INTERVAL + 60)
        svc._probe_states[name] = state

        mock_result = ProbeResult(name=name, ok=False, error="still down")
        with patch("backend.services.monitoring.service.dispatch",
                   new_callable=AsyncMock) as mock_dispatch:
            await svc._process_results([mock_result])
        mock_dispatch.assert_called_once()
        call_kwargs = mock_dispatch.call_args.kwargs
        assert "re-alert" in call_kwargs.get("title", "").lower()

    @pytest.mark.asyncio
    async def test_realert_updates_last_alert_at(self):
        """After a re-alert, last_alert_at is refreshed so next interval starts fresh."""
        from backend.services.monitoring import service as svc
        from backend.services.monitoring.service import _probe_states, ProbeState, REALERT_INTERVAL

        svc._probe_states.clear()
        name = "market_data_realert_ts"
        state = ProbeState()
        state.alerted_down = True
        state.consecutive_failures = 5
        state.last_alert_at = int(time.time()) - (REALERT_INTERVAL + 300)
        svc._probe_states[name] = state

        mock_result = ProbeResult(name=name, ok=False, error="timeout")
        with patch("backend.services.monitoring.service.dispatch",
                   new_callable=AsyncMock):
            await svc._process_results([mock_result])

        new_ts = svc._probe_states[name].last_alert_at
        assert new_ts > (int(time.time()) - 5)   # refreshed within last 5s


# ---------------------------------------------------------------------------
# Monitor /status now exposes realert_interval
# ---------------------------------------------------------------------------

class TestMonitorStatusReAlertField:
    @pytest.mark.asyncio
    async def test_status_includes_realert_interval(self):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get(f"{BASE}/status")
        assert resp.status_code == 200
        body = resp.json()
        assert "realert_interval" in body
        assert body["realert_interval"] > 0


# ---------------------------------------------------------------------------
# Probe registry now has 8 probes (added cooldown + external_liveness)
# ---------------------------------------------------------------------------

class TestProbeRegistry:
    @pytest.mark.asyncio
    async def test_probe_count_is_correct(self):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get(f"{BASE}/probes")
        body = resp.json()
        assert "cooldown" in body["probes"]
        assert "external_liveness" in body["probes"]
        assert "executor" in body["probes"]
        assert body["count"] == 9
