# tests/engine/test_coordinator_signal_gate.py
"""
Integration tests for the signal-gate step inside execute_intent().

Covers:
  - FLAT signal blocks BUY
  - FLAT signal blocks SELL
  - Opposing signal blocks (BUY intent vs SELL signal, vice-versa)
  - Aligned signal allows execution
  - No cached signal (cold start) → pass through
  - Kill switch still fires before signal gate
  - SignalGateDenied carries the right reason string
  - status on blocked result is RISK_REJECTED with venue=signal_gate
"""
from __future__ import annotations

import time
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.engine.coordinator import (
    ExecutionIntent,
    KillSwitchActive,
    SignalGateDenied,
    execute_intent,
)
from backend.logic.signal_engine import SignalRecord


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _intent(side: str = "BUY", symbol: str = "BTCUSDT") -> ExecutionIntent:
    return ExecutionIntent(
        symbol=symbol,
        side=side,
        order_type="MARKET",
        quantity=Decimal("0.01"),
        mode="paper",
    )


def _signal(side: str, symbol: str = "BTCUSDT", confidence: float = 0.8) -> SignalRecord:
    now = int(time.time())
    return SignalRecord(
        id=str(uuid.uuid4()),
        symbol=symbol,
        timeframe="1h",
        side=side,
        entry_price=50000.0,
        stop_loss=49000.0 if side == "BUY" else 51000.0,
        take_profit=52000.0 if side == "BUY" else 48000.0,
        confidence=confidence,
        strategy_id="combined",
        created_at=now,
        valid_until=now + 900,
        metadata={},
    )


def _mock_route() -> MagicMock:
    order = MagicMock()
    order.order_id = str(uuid.uuid4())
    order.fill_price = Decimal("50000")
    order.filled_qty = Decimal("0.01")
    order.venue = "paper"
    order.status = "FILLED"
    routed = MagicMock()
    routed.order = order
    return routed


_KS    = "backend.engine.coordinator.is_kill_switch_active"
_SIG   = "backend.engine.coordinator.get_cached_signal"
_RISK  = "backend.engine.coordinator._check_risk_approval"
_ROUTE = "backend.engine.coordinator.route_order"
_PNL   = "backend.engine.coordinator.process_fill"
_AUDIT = "backend.engine.coordinator._append_audit_entry"
_WS    = "backend.engine.coordinator._publish_order_update"
_HB    = "backend.engine.coordinator.record_heartbeat"


# ---------------------------------------------------------------------------
# 1. Signal gate — blocking cases
# ---------------------------------------------------------------------------

class TestSignalGateBlocks:
    @pytest.mark.asyncio
    async def test_flat_signal_blocks_buy(self):
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("FLAT")),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(SignalGateDenied) as exc_info:
                await execute_intent(_intent("BUY"))
        assert "FLAT" in str(exc_info.value)
        assert "BUY" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_flat_signal_blocks_sell(self):
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("FLAT")),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(SignalGateDenied):
                await execute_intent(_intent("SELL"))

    @pytest.mark.asyncio
    async def test_sell_signal_blocks_buy_intent(self):
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("SELL")),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(SignalGateDenied) as exc_info:
                await execute_intent(_intent("BUY"))
        assert "SELL" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_buy_signal_blocks_sell_intent(self):
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("BUY")),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(SignalGateDenied) as exc_info:
                await execute_intent(_intent("SELL"))
        assert "BUY" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_denied_result_has_correct_venue_and_status(self):
        captured = []

        async def _fake_audit(result, reason=None):
            captured.append(result)

        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("FLAT")),
            patch(_AUDIT, side_effect=_fake_audit),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(SignalGateDenied):
                await execute_intent(_intent("BUY"))

        assert len(captured) == 1
        assert captured[0].status == "RISK_REJECTED"
        assert captured[0].venue == "signal_gate"

    @pytest.mark.asyncio
    async def test_exception_carries_strategy_and_confidence(self):
        sig = _signal("FLAT", confidence=0.55)
        sig.strategy_id = "mean_reversion"
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=sig),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(SignalGateDenied) as exc_info:
                await execute_intent(_intent("BUY"))
        reason = str(exc_info.value)
        assert "mean_reversion" in reason
        assert "0.55" in reason


# ---------------------------------------------------------------------------
# 2. Signal gate — pass-through cases
# ---------------------------------------------------------------------------

class TestSignalGatePassThrough:
    @pytest.mark.asyncio
    async def test_buy_signal_allows_buy_intent(self):
        routed = _mock_route()
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("BUY")),
            patch(_RISK,  new=AsyncMock(return_value=(True, "approved"))),
            patch(_ROUTE, new=AsyncMock(return_value=routed)),
            patch(_PNL,   return_value=None),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
            patch(_HB,    new=AsyncMock()),
        ):
            result = await execute_intent(_intent("BUY"))
        assert result.status == "FILLED"

    @pytest.mark.asyncio
    async def test_sell_signal_allows_sell_intent(self):
        routed = _mock_route()
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=_signal("SELL")),
            patch(_RISK,  new=AsyncMock(return_value=(True, "approved"))),
            patch(_ROUTE, new=AsyncMock(return_value=routed)),
            patch(_PNL,   return_value=None),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
            patch(_HB,    new=AsyncMock()),
        ):
            result = await execute_intent(_intent("SELL"))
        assert result.status == "FILLED"

    @pytest.mark.asyncio
    async def test_no_cached_signal_passes_through(self):
        routed = _mock_route()
        with (
            patch(_KS,    new=AsyncMock(return_value=False)),
            patch(_SIG,   return_value=None),
            patch(_RISK,  new=AsyncMock(return_value=(True, "approved"))),
            patch(_ROUTE, new=AsyncMock(return_value=routed)),
            patch(_PNL,   return_value=None),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
            patch(_HB,    new=AsyncMock()),
        ):
            result = await execute_intent(_intent("BUY"))
        assert result.status == "FILLED"


# ---------------------------------------------------------------------------
# 3. Kill switch fires before signal gate
# ---------------------------------------------------------------------------

class TestKillSwitchPreemptsSignalGate:
    @pytest.mark.asyncio
    async def test_kill_switch_blocks_before_signal_gate(self):
        with (
            patch(_KS,    new=AsyncMock(return_value=True)),
            patch(_SIG,   return_value=_signal("BUY")),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(KillSwitchActive):
                await execute_intent(_intent("BUY"))

    @pytest.mark.asyncio
    async def test_signal_gate_not_called_when_ks_active(self):
        signal_calls = []

        def _track(symbol):
            signal_calls.append(symbol)
            return _signal("BUY")

        with (
            patch(_KS,    new=AsyncMock(return_value=True)),
            patch(_SIG,   side_effect=_track),
            patch(_AUDIT, new=AsyncMock()),
            patch(_WS,    new=AsyncMock()),
        ):
            with pytest.raises(KillSwitchActive):
                await execute_intent(_intent("BUY"))

        assert signal_calls == [], "Signal gate must NOT be reached after kill switch"


# ---------------------------------------------------------------------------
# 4. On-demand /signals/evaluate endpoint
# ---------------------------------------------------------------------------

class TestSignalsEvaluateEndpoint:
    @pytest.mark.asyncio
    async def test_evaluate_returns_signal_out(self):
        from httpx import AsyncClient, ASGITransport
        from backend.app import app

        fake_rec = _signal("BUY", symbol="ETHUSDT")
        with patch(
            "backend.routes.signals_v1.evaluate_signal",
            new=AsyncMock(return_value=fake_rec),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/signals/evaluate",
                    json={"symbol": "ethusdt", "timeframe": "1h"},
                )

        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "ETHUSDT"
        assert data["side"] == "BUY"
        assert "confidence" in data
        assert "metadata" in data

    @pytest.mark.asyncio
    async def test_evaluate_uppercases_symbol(self):
        from httpx import AsyncClient, ASGITransport
        from backend.app import app

        fake_rec = _signal("FLAT", symbol="BTCUSDT")
        with patch(
            "backend.routes.signals_v1.evaluate_signal",
            new=AsyncMock(return_value=fake_rec),
        ) as mock_eval:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                await client.post(
                    "/api/v1/signals/evaluate",
                    json={"symbol": "btcusdt"},
                )
        mock_eval.assert_called_once_with("BTCUSDT")

    @pytest.mark.asyncio
    async def test_evaluate_500_on_service_error(self):
        from httpx import AsyncClient, ASGITransport
        from backend.app import app

        with patch(
            "backend.routes.signals_v1.evaluate_signal",
            new=AsyncMock(side_effect=RuntimeError("adapter down")),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/signals/evaluate",
                    json={"symbol": "BTCUSDT"},
                )
        assert resp.status_code == 500
        assert "adapter down" in resp.json()["detail"]
