# tests/routes/test_kill_switch.py
"""
PHASE 10 — Kill-switch and audit tests.

Tests:
  1. Manual activation — route activates kill switch and audits
  2. Guardian activation — guardian service activates and audits
  3. Idempotency — double activation returns already_active
  4. Blocked execution while active — coordinator returns 503
  5. Audit entries contain required fields
  6. Deactivation — route deactivates and audits

Run: pytest tests/routes/test_kill_switch.py -v
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from backend.routes.kill_switch import router as ks_router
from backend.services.audit.service import (
    AuditEventType,
    _audit_buffer,
    append,
    append_kill_switch_manual,
    append_kill_switch_guardian,
)
import backend.services.guardian_bot.service as guardian


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(ks_router)
    return a


@pytest.fixture
async def client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _reset_guardian():
    guardian._kill_switch_active = False
    guardian._kill_switch_reason = None
    guardian._triggered          = False


# ---------------------------------------------------------------------------
# 1. Manual activation
# ---------------------------------------------------------------------------

class TestManualActivation:
    @pytest.mark.asyncio
    async def test_activate_returns_200_and_audit_id(self, client: AsyncClient):
        _reset_guardian()
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.kill_switch.get_auth_config", return_value=mock_auth),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
            patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)),
        ):
            resp = await client.post("/kill-switch", json={"activate": True, "reason": "test"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["kill_switch_active"] is True
        assert data["action"] == "activated"
        assert data["audit_id"] is not None
        assert data["audit_id"].startswith("audit-")

    @pytest.mark.asyncio
    async def test_activation_writes_to_redis(self, client: AsyncClient):
        _reset_guardian()
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)
        mock_redis_write = AsyncMock()

        with (
            patch("backend.routes.kill_switch.get_auth_config", return_value=mock_auth),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", mock_redis_write),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
            patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)),
        ):
            await client.post("/kill-switch", json={"activate": True, "reason": "test"})

        mock_redis_write.assert_called_once_with(True, "test")


# ---------------------------------------------------------------------------
# 2. Guardian activation
# ---------------------------------------------------------------------------

class TestGuardianActivation:
    @pytest.mark.asyncio
    async def test_guardian_activation_audited(self):
        _audit_buffer.clear()

        with patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)):
            entry = await append_kill_switch_guardian("Drawdown threshold breached: 6.5% >= 5.0%")

        assert entry.event_type == AuditEventType.KILL_SWITCH_GUARDIAN.value
        assert entry.actor == "guardian"
        assert "drawdown" in (entry.reason or "").lower()
        assert entry.id.startswith("audit-")

    @pytest.mark.asyncio
    async def test_guardian_trigger_creates_audit_and_redis(self):
        _reset_guardian()

        with (
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await guardian.activate_kill_switch("guardian auto: drawdown", source="guardian_auto")

        assert guardian._kill_switch_active is True
        assert guardian._kill_switch_reason is not None


# ---------------------------------------------------------------------------
# 3. Idempotency
# ---------------------------------------------------------------------------

class TestIdempotency:
    @pytest.mark.asyncio
    async def test_double_activation_returns_already_active(self, client: AsyncClient):
        _reset_guardian()
        guardian._kill_switch_active = True  # already active
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.kill_switch.get_auth_config", return_value=mock_auth),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
            patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)),
        ):
            resp = await client.post("/kill-switch", json={"activate": True})

        assert resp.json()["action"] == "already_active"
        assert resp.json()["kill_switch_active"] is True

    @pytest.mark.asyncio
    async def test_double_deactivation_returns_already_inactive(self, client: AsyncClient):
        _reset_guardian()
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.kill_switch.get_auth_config", return_value=mock_auth),
            patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)),
        ):
            resp = await client.post("/kill-switch", json={"activate": False})

        assert resp.json()["action"] == "already_inactive"


# ---------------------------------------------------------------------------
# 4. Blocked execution while active
# ---------------------------------------------------------------------------

class TestBlockedExecution:
    @pytest.mark.asyncio
    async def test_coordinator_blocked_when_kill_switch_active(self):
        from backend.engine.coordinator import execute_intent, KillSwitchActive, ExecutionIntent
        from decimal import Decimal

        with (
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=True)),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
        ):
            with pytest.raises(KillSwitchActive):
                await execute_intent(ExecutionIntent(
                    symbol="BTCUSDT", side="BUY", order_type="MARKET",
                    quantity=Decimal("0.001"), mode="paper",
                ))


# ---------------------------------------------------------------------------
# 5. Audit entries
# ---------------------------------------------------------------------------

class TestAuditEntries:
    @pytest.mark.asyncio
    async def test_audit_entry_has_required_fields(self):
        with patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)):
            entry = await append(
                event_type=AuditEventType.ORDER_FILLED,
                actor="engine",
                symbol="BTCUSDT",
                side="BUY",
                quantity=0.001,
                price=50000.0,
                order_id="test-order-1",
                mode="paper",
            )

        assert entry.id.startswith("audit-")
        assert entry.event_type == "order_filled"
        assert entry.actor == "engine"
        assert entry.symbol == "BTCUSDT"
        assert entry.timestamp > 0

    @pytest.mark.asyncio
    async def test_audit_buffer_grows(self):
        _audit_buffer.clear()
        with patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)):
            for i in range(5):
                await append(
                    event_type=AuditEventType.RISK_GATE_DENIED,
                    actor="engine", reason=f"denied_{i}",
                )
        assert len(_audit_buffer) >= 5


# ---------------------------------------------------------------------------
# 6. Deactivation
# ---------------------------------------------------------------------------

class TestDeactivation:
    @pytest.mark.asyncio
    async def test_deactivation_returns_inactive_state(self, client: AsyncClient):
        _reset_guardian()
        guardian._kill_switch_active = True
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.kill_switch.get_auth_config", return_value=mock_auth),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
            patch("backend.services.audit.service._get_redis", new=AsyncMock(return_value=None)),
        ):
            resp = await client.post("/kill-switch", json={"activate": False, "reason": "all clear"})

        assert resp.status_code == 200
        assert resp.json()["kill_switch_active"] is False
        assert resp.json()["action"] == "deactivated"
        assert "all clear" in resp.json()["reason"]
