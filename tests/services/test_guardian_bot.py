# tests/services/test_guardian_bot.py
"""
PHASE 8 — Guardian service tests.

Tests:
  1. Trigger conditions — drawdown, API errors, failed orders
  2. Heartbeat timeout — auto-halt when engine goes silent
  3. Status output — correct shape and values
  4. Override behavior — operator deactivation
  5. Idempotency — double activation doesn't corrupt state
  6. Redis write confirmed on kill switch activation

Run: pytest tests/services/test_guardian_bot.py -v
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

import backend.services.guardian_bot.service as guardian


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_guardian_state():
    """Reset all in-process guardian state before each test."""
    guardian._kill_switch_active  = False
    guardian._kill_switch_reason  = None
    guardian._triggered           = False
    guardian._trigger_reason      = None
    guardian._drawdown_pct        = 0.0
    guardian._daily_loss_pct      = 0.0
    guardian._api_error_count     = 0
    guardian._failed_order_count  = 0
    guardian._last_heartbeat_at   = None
    guardian._kill_switch_at      = None


def _mock_risk_config(
    max_drawdown_pct: float = 5.0,
    max_api_errors:   int   = 10,
    max_failed_orders: int  = 5,
):
    from backend.config.loader import RiskConfig
    return RiskConfig(
        risk_tolerance=0.5,
        position_size_fraction=0.1,
        spread_stress_threshold=0.002,
        volatility_sensitivity=0.5,
        max_drawdown_pct=max_drawdown_pct,
        max_api_errors=max_api_errors,
        max_failed_orders=max_failed_orders,
    )


# ---------------------------------------------------------------------------
# 1. Trigger conditions
# ---------------------------------------------------------------------------

class TestTriggerConditions:
    @pytest.mark.asyncio
    async def test_drawdown_triggers_kill_switch(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_drawdown_pct=5.0)

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.update_drawdown(6.0)  # exceeds 5% threshold

        assert guardian._kill_switch_active is True
        assert "drawdown" in (guardian._kill_switch_reason or "").lower()

    @pytest.mark.asyncio
    async def test_drawdown_below_threshold_does_not_trigger(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_drawdown_pct=5.0)

        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            await guardian.update_drawdown(4.9)

        assert guardian._kill_switch_active is False

    @pytest.mark.asyncio
    async def test_api_errors_trigger_kill_switch(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_api_errors=3)

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            for _ in range(3):
                await guardian.on_api_error()

        assert guardian._kill_switch_active is True
        assert guardian._api_error_count == 3

    @pytest.mark.asyncio
    async def test_failed_orders_trigger_kill_switch(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_failed_orders=2)

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.on_failed_order()
            await guardian.on_failed_order()

        assert guardian._kill_switch_active is True
        assert "failed order" in (guardian._kill_switch_reason or "").lower()

    @pytest.mark.asyncio
    async def test_single_api_error_does_not_trigger(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_api_errors=10)

        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            await guardian.on_api_error()

        assert guardian._kill_switch_active is False
        assert guardian._api_error_count == 1


# ---------------------------------------------------------------------------
# 2. Heartbeat timeout
# ---------------------------------------------------------------------------

class TestHeartbeatTimeout:
    @pytest.mark.asyncio
    async def test_heartbeat_loss_triggers_auto_halt(self):
        _reset_guardian_state()
        # Set old heartbeat
        guardian._last_heartbeat_at = int(time.time()) - 200  # 200s ago

        from backend.services.guardian_bot.service import GuardianThresholds
        thresholds = GuardianThresholds(
            max_drawdown_pct=5.0,
            max_daily_loss_pct=10.0,
            max_api_errors=10,
            max_failed_orders=5,
            heartbeat_timeout_s=90,
        )

        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian._check_heartbeat(thresholds)

        assert guardian._kill_switch_active is True
        assert "heartbeat" in (guardian._kill_switch_reason or "").lower()

    @pytest.mark.asyncio
    async def test_recent_heartbeat_does_not_trigger(self):
        _reset_guardian_state()
        guardian._last_heartbeat_at = int(time.time()) - 10  # 10s ago — healthy

        from backend.services.guardian_bot.service import GuardianThresholds
        thresholds = GuardianThresholds(
            max_drawdown_pct=5.0, max_daily_loss_pct=10.0,
            max_api_errors=10, max_failed_orders=5, heartbeat_timeout_s=90,
        )

        await guardian._check_heartbeat(thresholds)

        assert guardian._kill_switch_active is False

    def test_record_heartbeat_updates_timestamp(self):
        _reset_guardian_state()
        before = int(time.time())
        guardian.record_heartbeat()
        assert guardian._last_heartbeat_at is not None
        assert guardian._last_heartbeat_at >= before

    @pytest.mark.asyncio
    async def test_no_heartbeat_does_not_trigger_on_startup(self):
        """If heartbeat has never been set, don't auto-halt (engine may not have started)."""
        _reset_guardian_state()
        guardian._last_heartbeat_at = None

        from backend.services.guardian_bot.service import GuardianThresholds
        thresholds = GuardianThresholds(
            max_drawdown_pct=5.0, max_daily_loss_pct=10.0,
            max_api_errors=10, max_failed_orders=5, heartbeat_timeout_s=90,
        )

        await guardian._check_heartbeat(thresholds)
        assert guardian._kill_switch_active is False


# ---------------------------------------------------------------------------
# 3. Status output
# ---------------------------------------------------------------------------

class TestStatusOutput:
    @pytest.mark.asyncio
    async def test_status_has_correct_fields(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config()

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._check_exchange_health",
                  new=AsyncMock(return_value={"connected": True, "market_data_mode": "paper_live"})),
        ):
            status = await guardian.get_guardian_status()

        assert status.kill_switch_active is False
        assert status.drawdown_pct == pytest.approx(0.0)
        assert status.api_error_count == 0
        assert status.thresholds.max_drawdown_pct == pytest.approx(5.0)
        assert status.computed_at > 0

    @pytest.mark.asyncio
    async def test_status_reflects_active_kill_switch(self):
        _reset_guardian_state()
        guardian._kill_switch_active = True
        guardian._kill_switch_reason = "test reason"
        risk_cfg = _mock_risk_config()

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._check_exchange_health",
                  new=AsyncMock(return_value={})),
        ):
            status = await guardian.get_guardian_status()

        assert status.kill_switch_active is True
        assert status.kill_switch_reason == "test reason"


# ---------------------------------------------------------------------------
# 4. Override behavior
# ---------------------------------------------------------------------------

class TestOverrideBehavior:
    @pytest.mark.asyncio
    async def test_operator_can_deactivate_kill_switch(self):
        _reset_guardian_state()
        guardian._kill_switch_active = True
        guardian._kill_switch_reason = "auto trigger"

        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.deactivate_kill_switch("Operator manual reset")

        assert guardian._kill_switch_active is False
        assert guardian._kill_switch_reason is None

    def test_reset_counters_clears_errors(self):
        _reset_guardian_state()
        guardian._api_error_count    = 7
        guardian._failed_order_count = 3

        guardian.reset_counters()

        assert guardian._api_error_count    == 0
        assert guardian._failed_order_count == 0


# ---------------------------------------------------------------------------
# 5. Idempotency
# ---------------------------------------------------------------------------

class TestIdempotency:
    @pytest.mark.asyncio
    async def test_double_activation_does_not_corrupt_state(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config()

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.activate_kill_switch("first reason")
            first_reason = guardian._kill_switch_reason
            await guardian.activate_kill_switch("second reason")

        # Kill switch stays active; reason updated to latest
        assert guardian._kill_switch_active is True
        assert guardian._kill_switch_reason == "second reason"


# ---------------------------------------------------------------------------
# 6. Redis write confirmed on kill switch activation
# ---------------------------------------------------------------------------

class TestRedisWrite:
    @pytest.mark.asyncio
    async def test_redis_write_called_on_activation(self):
        _reset_guardian_state()
        mock_redis_write = AsyncMock()

        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", mock_redis_write),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.activate_kill_switch("test activation")

        mock_redis_write.assert_called_once_with(True, "test activation")

    @pytest.mark.asyncio
    async def test_is_kill_switch_active_reads_redis(self):
        """Kill switch check prefers Redis over in-process state."""
        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value="1")

        guardian._kill_switch_active = False  # in-process says False

        with patch("backend.services.guardian_bot.service._get_redis",
                   new=AsyncMock(return_value=mock_redis)):
            result = await guardian.is_kill_switch_active()

        assert result is True  # Redis says True — Redis wins
