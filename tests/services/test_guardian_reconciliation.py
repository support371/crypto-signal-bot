from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

import backend.services.guardian_bot.service as guardian


def _reset_guardian_state() -> None:
    guardian._kill_switch_active = False
    guardian._kill_switch_reason = None
    guardian._triggered = False
    guardian._trigger_reason = None
    guardian._reconciliation_drift_count = 0
    guardian._reconciliation_drift_reason = None


@pytest.mark.asyncio
async def test_reconciliation_match_resets_drift_state():
    _reset_guardian_state()
    guardian._reconciliation_drift_count = 2
    guardian._reconciliation_drift_reason = "prior drift"

    result = await guardian.on_reconciliation_check(
        local_open_order_ids=["order-1", "order-2"],
        venue_open_order_ids=["order-2", "order-1"],
    )

    assert result is True
    assert guardian._reconciliation_drift_count == 0
    assert guardian._reconciliation_drift_reason is None
    assert guardian._kill_switch_active is False


@pytest.mark.asyncio
async def test_reconciliation_drift_inside_tolerance_does_not_halt():
    _reset_guardian_state()

    with (
        patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()) as redis_write,
        patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()) as publish,
    ):
        result = await guardian.on_reconciliation_check(
            local_open_order_ids=["order-1"],
            venue_open_order_ids=[],
            tolerance_cycles=3,
        )

    assert result is True
    assert guardian._reconciliation_drift_count == 1
    assert "missing_on_venue" in (guardian._reconciliation_drift_reason or "")
    assert guardian._kill_switch_active is False
    redis_write.assert_not_called()
    publish.assert_not_called()


@pytest.mark.asyncio
async def test_persistent_reconciliation_drift_triggers_kill_switch():
    _reset_guardian_state()

    with (
        patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()) as redis_write,
        patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()) as publish,
    ):
        await guardian.on_reconciliation_check(
            local_open_order_ids=["order-1"],
            venue_open_order_ids=[],
            tolerance_cycles=2,
        )
        result = await guardian.on_reconciliation_check(
            local_open_order_ids=["order-1"],
            venue_open_order_ids=[],
            tolerance_cycles=2,
        )

    assert result is False
    assert guardian._kill_switch_active is True
    assert "reconciliation drift" in (guardian._kill_switch_reason or "").lower()
    redis_write.assert_called_once()
    assert publish.await_count == 2


@pytest.mark.asyncio
async def test_reconciliation_status_exposes_drift_state():
    _reset_guardian_state()
    await guardian.on_reconciliation_check(
        local_open_order_ids=["order-1"],
        venue_open_order_ids=["order-2"],
        tolerance_cycles=3,
    )

    risk_cfg = type(
        "RiskCfg",
        (),
        {
            "max_drawdown_pct": 5.0,
            "max_api_errors": 10,
            "max_failed_orders": 5,
        },
    )()

    with (
        patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
        patch("backend.services.guardian_bot.service._check_exchange_health", new=AsyncMock(return_value={})),
    ):
        status = await guardian.get_guardian_status()

    assert status.reconciliation_drift_active is True
    assert status.reconciliation_drift_count == 1
    assert "unknown_on_venue" in (status.reconciliation_drift_reason or "")
