from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

import backend.services.guardian_bot.service as guardian


def _reset_guardian_state() -> None:
    guardian._strategy_kill_switches.clear()
    guardian._venue_kill_switches.clear()


@pytest.mark.asyncio
async def test_strategy_kill_switch_blocks_scope():
    _reset_guardian_state()
    with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
        await guardian.kill_strategy("Mean-Reversion", reason="bad fills")

    assert guardian.is_strategy_killed("mean-reversion") is True
    with pytest.raises(guardian.TradingScopeHaltedError):
        guardian.assert_scope_allowed(strategy_id="mean-reversion")


@pytest.mark.asyncio
async def test_strategy_revive_allows_scope():
    _reset_guardian_state()
    with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
        await guardian.kill_strategy("trend")
        await guardian.revive_strategy("trend")

    assert guardian.is_strategy_killed("trend") is False
    assert guardian.assert_scope_allowed(strategy_id="trend") is True


@pytest.mark.asyncio
async def test_venue_kill_switch_blocks_scope():
    _reset_guardian_state()
    with patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()):
        await guardian.kill_venue("Binance", reason="venue degraded")

    assert guardian.is_venue_killed("binance") is True
    with pytest.raises(guardian.TradingScopeHaltedError):
        guardian.assert_scope_allowed(venue_id="binance")


@pytest.mark.asyncio
async def test_scoped_status_lists_active_switches():
    _reset_guardian_state()
    risk_cfg = type(
        "RiskCfg",
        (),
        {"max_drawdown_pct": 5.0, "max_api_errors": 10, "max_failed_orders": 5},
    )()

    with (
        patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        patch("backend.services.guardian_bot.service.get_risk_config", return_value=risk_cfg),
        patch("backend.services.guardian_bot.service._check_exchange_health", new=AsyncMock(return_value={})),
    ):
        await guardian.kill_strategy("alpha")
        await guardian.kill_venue("btcc")
        status = await guardian.get_guardian_status()

    assert status.strategy_kill_switches == ("alpha",)
    assert status.venue_kill_switches == ("btcc",)
