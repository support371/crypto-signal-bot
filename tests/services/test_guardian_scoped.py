# tests/services/test_guardian_scoped.py
"""
Guardian service — scoped kill switches, reconciliation drift, cooldown,
runtime threshold management, daily loss updates, and context mirroring.

Complements test_guardian_bot.py which covers trigger conditions,
heartbeat, status output, override behavior, idempotency, and Redis writes.

Run: pytest tests/services/test_guardian_scoped.py -v
"""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, patch

import pytest

import backend.services.guardian_bot.service as guardian
from backend.services.guardian_bot.service import TradingScopeHaltedError


def _reset_guardian_state():
    guardian._kill_switch_active = False
    guardian._kill_switch_reason = None
    guardian._triggered = False
    guardian._trigger_reason = None
    guardian._drawdown_pct = 0.0
    guardian._daily_loss_pct = 0.0
    guardian._api_error_count = 0
    guardian._failed_order_count = 0
    guardian._last_heartbeat_at = None
    guardian._kill_switch_at = None
    guardian._kill_switch_deactivated_at = None
    guardian._reconciliation_drift_count = 0
    guardian._reconciliation_drift_reason = None
    guardian._strategy_kill_switches.clear()
    guardian._venue_kill_switches.clear()
    guardian._rt_max_drawdown_pct = None
    guardian._rt_max_daily_loss_pct = None
    guardian._rt_max_api_errors = None
    guardian._rt_max_failed_orders = None


def _mock_risk_config(
    max_drawdown_pct: float = 5.0,
    max_api_errors: int = 10,
    max_failed_orders: int = 5,
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
# 1. Scoped kill switches — strategy
# ---------------------------------------------------------------------------

class TestStrategyKillSwitch:
    @pytest.mark.asyncio
    async def test_kill_strategy_adds_to_set(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_strategy("momentum_v2")
        assert guardian.is_strategy_killed("momentum_v2")

    @pytest.mark.asyncio
    async def test_revive_strategy_removes_from_set(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_strategy("momentum_v2")
            await guardian.revive_strategy("momentum_v2")
        assert not guardian.is_strategy_killed("momentum_v2")

    @pytest.mark.asyncio
    async def test_strategy_id_normalized_to_lowercase(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_strategy("MOMENTUM_V2")
        assert guardian.is_strategy_killed("momentum_v2")
        assert guardian.is_strategy_killed("Momentum_V2")

    @pytest.mark.asyncio
    async def test_revive_unknown_strategy_is_noop(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.revive_strategy("nonexistent")
        assert len(guardian._strategy_kill_switches) == 0

    @pytest.mark.asyncio
    async def test_multiple_strategies_killed(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_strategy("strat_a")
            await guardian.kill_strategy("strat_b")
        assert guardian.is_strategy_killed("strat_a")
        assert guardian.is_strategy_killed("strat_b")
        assert not guardian.is_strategy_killed("strat_c")


# ---------------------------------------------------------------------------
# 2. Scoped kill switches — venue
# ---------------------------------------------------------------------------

class TestVenueKillSwitch:
    @pytest.mark.asyncio
    async def test_kill_venue_adds_to_set(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_venue("binance")
        assert guardian.is_venue_killed("binance")

    @pytest.mark.asyncio
    async def test_revive_venue_removes_from_set(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_venue("binance")
            await guardian.revive_venue("binance")
        assert not guardian.is_venue_killed("binance")

    @pytest.mark.asyncio
    async def test_venue_id_normalized_to_lowercase(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_venue("BITGET")
        assert guardian.is_venue_killed("bitget")


# ---------------------------------------------------------------------------
# 3. assert_scope_allowed
# ---------------------------------------------------------------------------

class TestAssertScopeAllowed:
    @pytest.mark.asyncio
    async def test_allowed_when_no_kill_switches(self):
        _reset_guardian_state()
        assert guardian.assert_scope_allowed(strategy_id="strat_a", venue_id="binance") is True

    @pytest.mark.asyncio
    async def test_raises_when_strategy_killed(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_strategy("strat_a")
        with pytest.raises(TradingScopeHaltedError, match="strat_a"):
            guardian.assert_scope_allowed(strategy_id="strat_a")

    @pytest.mark.asyncio
    async def test_raises_when_venue_killed(self):
        _reset_guardian_state()
        with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
            await guardian.kill_venue("binance")
        with pytest.raises(TradingScopeHaltedError, match="binance"):
            guardian.assert_scope_allowed(venue_id="binance")

    def test_none_scope_ids_pass(self):
        _reset_guardian_state()
        assert guardian.assert_scope_allowed(strategy_id=None, venue_id=None) is True

    def test_empty_scope_id_raises_value_error(self):
        with pytest.raises(ValueError, match="non-empty"):
            guardian._normalize_scope_id("")

    def test_whitespace_scope_id_raises_value_error(self):
        with pytest.raises(ValueError, match="non-empty"):
            guardian._normalize_scope_id("   ")


# ---------------------------------------------------------------------------
# 4. Reconciliation drift
# ---------------------------------------------------------------------------

class TestReconciliationDrift:
    @pytest.mark.asyncio
    async def test_no_drift_resets_count(self):
        _reset_guardian_state()
        guardian._reconciliation_drift_count = 2
        result = await guardian.on_reconciliation_check(
            local_open_order_ids=["o1", "o2"],
            venue_open_order_ids=["o1", "o2"],
        )
        assert result is True
        assert guardian._reconciliation_drift_count == 0
        assert guardian._reconciliation_drift_reason is None

    @pytest.mark.asyncio
    async def test_drift_increments_count(self):
        _reset_guardian_state()
        result = await guardian.on_reconciliation_check(
            local_open_order_ids=["o1", "o2"],
            venue_open_order_ids=["o1"],
        )
        assert result is True
        assert guardian._reconciliation_drift_count == 1
        assert "missing_on_venue" in guardian._reconciliation_drift_reason

    @pytest.mark.asyncio
    async def test_persistent_drift_triggers_kill_switch(self):
        _reset_guardian_state()
        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            for _ in range(3):
                result = await guardian.on_reconciliation_check(
                    local_open_order_ids=["o1"],
                    venue_open_order_ids=["o1", "o_unknown"],
                    tolerance_cycles=3,
                )
        assert result is False
        assert guardian._kill_switch_active is True
        assert "reconciliation" in (guardian._kill_switch_reason or "").lower()

    @pytest.mark.asyncio
    async def test_drift_below_tolerance_does_not_trigger(self):
        _reset_guardian_state()
        for _ in range(2):
            result = await guardian.on_reconciliation_check(
                local_open_order_ids=["o1"],
                venue_open_order_ids=[],
                tolerance_cycles=3,
            )
        assert result is True
        assert guardian._kill_switch_active is False
        assert guardian._reconciliation_drift_count == 2

    @pytest.mark.asyncio
    async def test_unknown_on_venue_detected(self):
        _reset_guardian_state()
        await guardian.on_reconciliation_check(
            local_open_order_ids=[],
            venue_open_order_ids=["phantom_order"],
        )
        assert "unknown_on_venue" in guardian._reconciliation_drift_reason

    @pytest.mark.asyncio
    async def test_empty_order_ids_no_drift(self):
        _reset_guardian_state()
        result = await guardian.on_reconciliation_check(
            local_open_order_ids=[],
            venue_open_order_ids=[],
        )
        assert result is True
        assert guardian._reconciliation_drift_count == 0


# ---------------------------------------------------------------------------
# 5. Cooldown logic
# ---------------------------------------------------------------------------

class TestCooldownLogic:
    def test_not_in_cooldown_when_never_deactivated(self):
        _reset_guardian_state()
        assert guardian.is_in_cooldown() is False
        assert guardian.cooldown_remaining_seconds() == 0

    def test_in_cooldown_immediately_after_deactivation(self):
        _reset_guardian_state()
        guardian._kill_switch_deactivated_at = int(time.time())
        with patch("backend.services.guardian_bot.service.get_cooldown_seconds", return_value=60):
            assert guardian.is_in_cooldown() is True
            remaining = guardian.cooldown_remaining_seconds()
            assert 55 <= remaining <= 60

    def test_cooldown_expired(self):
        _reset_guardian_state()
        guardian._kill_switch_deactivated_at = int(time.time()) - 120
        with patch("backend.services.guardian_bot.service.get_cooldown_seconds", return_value=60):
            assert guardian.is_in_cooldown() is False
            assert guardian.cooldown_remaining_seconds() == 0


# ---------------------------------------------------------------------------
# 6. Runtime threshold management
# ---------------------------------------------------------------------------

class TestRuntimeThresholds:
    def test_defaults_come_from_config(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_drawdown_pct=5.0, max_api_errors=10, max_failed_orders=5)
        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            rt = guardian.get_runtime_thresholds()
        assert rt["max_drawdown_pct"] == 5.0
        assert rt["max_api_errors"] == 10
        assert rt["max_failed_orders"] == 5
        assert rt["overridden"] is False

    def test_set_overrides_specific_thresholds(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config()
        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            result = guardian.set_runtime_thresholds(max_drawdown_pct=3.0)
        assert result["max_drawdown_pct"] == 3.0
        assert result["overridden"] is True

    def test_reset_clears_all_overrides(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_drawdown_pct=5.0)
        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            guardian.set_runtime_thresholds(max_drawdown_pct=2.0)
            result = guardian.reset_runtime_thresholds()
        assert result["max_drawdown_pct"] == 5.0
        assert result["overridden"] is False

    def test_invalid_drawdown_raises(self):
        _reset_guardian_state()
        with pytest.raises(ValueError, match="max_drawdown_pct"):
            guardian.set_runtime_thresholds(max_drawdown_pct=0.0)
        with pytest.raises(ValueError, match="max_drawdown_pct"):
            guardian.set_runtime_thresholds(max_drawdown_pct=101.0)

    def test_invalid_daily_loss_raises(self):
        _reset_guardian_state()
        with pytest.raises(ValueError, match="max_daily_loss_pct"):
            guardian.set_runtime_thresholds(max_daily_loss_pct=-1.0)

    def test_invalid_api_errors_raises(self):
        _reset_guardian_state()
        with pytest.raises(ValueError, match="max_api_errors"):
            guardian.set_runtime_thresholds(max_api_errors=0)

    def test_invalid_failed_orders_raises(self):
        _reset_guardian_state()
        with pytest.raises(ValueError, match="max_failed_orders"):
            guardian.set_runtime_thresholds(max_failed_orders=0)

    def test_partial_override_preserves_other_config(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config(max_drawdown_pct=5.0, max_api_errors=10, max_failed_orders=5)
        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            guardian.set_runtime_thresholds(max_api_errors=3)
            rt = guardian.get_runtime_thresholds()
        assert rt["max_drawdown_pct"] == 5.0
        assert rt["max_api_errors"] == 3
        assert rt["max_failed_orders"] == 5


# ---------------------------------------------------------------------------
# 7. Daily loss updates
# ---------------------------------------------------------------------------

class TestDailyLoss:
    @pytest.mark.asyncio
    async def test_update_daily_loss_stores_value(self):
        _reset_guardian_state()
        await guardian.update_daily_loss(2.5)
        assert guardian._daily_loss_pct == 2.5

    @pytest.mark.asyncio
    async def test_update_daily_loss_zero(self):
        _reset_guardian_state()
        guardian._daily_loss_pct = 3.0
        await guardian.update_daily_loss(0.0)
        assert guardian._daily_loss_pct == 0.0


# ---------------------------------------------------------------------------
# 8. Context mirroring
# ---------------------------------------------------------------------------

class TestContextMirroring:
    @pytest.mark.asyncio
    async def test_activate_mirrors_to_context(self):
        _reset_guardian_state()
        from backend.logic import context
        context.kill_switch_active = False
        context.guardian_triggered = False

        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.activate_kill_switch("test mirror")

        assert context.kill_switch_active is True
        assert context.kill_switch_reason == "test mirror"
        assert context.guardian_triggered is True

    @pytest.mark.asyncio
    async def test_deactivate_mirrors_to_context(self):
        _reset_guardian_state()
        from backend.logic import context
        context.kill_switch_active = True
        context.kill_switch_reason = "some reason"

        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.deactivate_kill_switch("manual reset")

        assert context.kill_switch_active is False
        assert context.kill_switch_reason is None

    def test_reset_counters_mirrors_to_context(self):
        _reset_guardian_state()
        from backend.logic import context
        context.api_error_count = 5
        context.failed_order_count = 3
        context.guardian_triggered = True

        guardian._api_error_count = 5
        guardian._failed_order_count = 3
        guardian.reset_counters()

        assert context.api_error_count == 0
        assert context.failed_order_count == 0
        assert context.guardian_triggered is False

    @pytest.mark.asyncio
    async def test_on_api_error_mirrors_count_to_context(self):
        _reset_guardian_state()
        from backend.logic import context
        context.api_error_count = 0
        risk_cfg = _mock_risk_config(max_api_errors=100)

        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            await guardian.on_api_error()

        assert context.api_error_count == 1

    @pytest.mark.asyncio
    async def test_on_failed_order_mirrors_count_to_context(self):
        _reset_guardian_state()
        from backend.logic import context
        context.failed_order_count = 0
        risk_cfg = _mock_risk_config(max_failed_orders=100)

        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            await guardian.on_failed_order()

        assert context.failed_order_count == 1

    @pytest.mark.asyncio
    async def test_drawdown_update_mirrors_to_context(self):
        _reset_guardian_state()
        from backend.logic import context
        risk_cfg = _mock_risk_config(max_drawdown_pct=10.0)

        with patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg):
            await guardian.update_drawdown(3.5)

        assert context.guardian_drawdown_pct == 3.5


# ---------------------------------------------------------------------------
# 9. Guardian status includes scoped switches and cooldown
# ---------------------------------------------------------------------------

class TestGuardianStatusExtended:
    @pytest.mark.asyncio
    async def test_status_includes_strategy_kill_switches(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config()
        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._check_exchange_health",
                  new=AsyncMock(return_value={"connected": True})),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.kill_strategy("strat_a")
            await guardian.kill_strategy("strat_b")
            status = await guardian.get_guardian_status()

        assert "strat_a" in status.strategy_kill_switches
        assert "strat_b" in status.strategy_kill_switches

    @pytest.mark.asyncio
    async def test_status_includes_venue_kill_switches(self):
        _reset_guardian_state()
        risk_cfg = _mock_risk_config()
        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._check_exchange_health",
                  new=AsyncMock(return_value={"connected": True})),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.kill_venue("bitget")
            status = await guardian.get_guardian_status()

        assert "bitget" in status.venue_kill_switches

    @pytest.mark.asyncio
    async def test_status_includes_reconciliation_drift(self):
        _reset_guardian_state()
        guardian._reconciliation_drift_count = 2
        guardian._reconciliation_drift_reason = "test drift"
        risk_cfg = _mock_risk_config()

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._check_exchange_health",
                  new=AsyncMock(return_value={"connected": True})),
        ):
            status = await guardian.get_guardian_status()

        assert status.reconciliation_drift_count == 2
        assert status.reconciliation_drift_active is True
        assert status.reconciliation_drift_reason == "test drift"

    @pytest.mark.asyncio
    async def test_status_includes_cooldown(self):
        _reset_guardian_state()
        guardian._kill_switch_deactivated_at = int(time.time())
        risk_cfg = _mock_risk_config()

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
            patch("backend.services.guardian_bot.service._check_exchange_health",
                  new=AsyncMock(return_value={"connected": True})),
            patch("backend.services.guardian_bot.service.get_cooldown_seconds", return_value=60),
        ):
            status = await guardian.get_guardian_status()

        assert status.in_cooldown is True
        assert status.cooldown_remaining_s > 0
