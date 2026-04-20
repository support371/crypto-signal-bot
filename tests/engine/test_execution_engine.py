# tests/engine/test_execution_engine.py
"""
PHASE 9 — Execution engine tests.

Tests:
  1. Routing — primary adapter used, order returned
  2. Retry/failover — transient error retried, failover on exhaustion
  3. Blocked submission — kill switch active blocks execution
  4. Blocked by risk gate — risk_rejected returned
  5. State updates — P&L and balance updated after fill
  6. P&L computation — realized and unrealized values
  7. Intent route — correct HTTP shapes and error codes
  8. No simulated fills confirmation — live path uses adapter

Run: pytest tests/engine/test_execution_engine.py -v
"""

from __future__ import annotations

import time
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from backend.adapters.exchanges.base import (
    AdapterUnavailableError,
    AdapterRateLimitError,
    AdapterOrderError,
    Order,
    Ticker,
)
from backend.engine.coordinator import (
    ExecutionIntent,
    KillSwitchActive,
    RiskGateDenied,
    execute_intent,
)
from backend.engine.routing import (
    ExecutionFailed,
    ExecutionRejected,
    route_order,
)
from backend.engine.pnl import (
    process_fill,
    get_pnl_summary,
    get_usdt_balance,
    reset_pnl_state,
)
from backend.routes.intent import router as intent_router


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(intent_router)
    return a


@pytest.fixture
async def client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_order(
    order_id: str = "test-001",
    symbol: str = "BTCUSDT",
    side: str = "BUY",
    fill_price: float = 50_000.0,
    status: str = "FILLED",
    qty: float = 0.001,
) -> Order:
    return Order(
        id=order_id, symbol=symbol, side=side,
        order_type="MARKET",
        quantity=Decimal(str(qty)),
        price=None,
        fill_price=Decimal(str(fill_price)),
        filled_qty=Decimal(str(qty)),
        status=status,
        created_at=int(time.time()),
        updated_at=int(time.time()),
    )


def _make_adapter(order: Order, name: str = "test"):
    m = MagicMock()
    m.create_order = AsyncMock(return_value=order)
    m.exchange_name = name
    return m


def _intent(
    symbol: str = "BTCUSDT",
    side: str = "BUY",
    qty: float = 0.001,
    mode: str = "paper",
) -> ExecutionIntent:
    return ExecutionIntent(
        symbol=symbol, side=side, order_type="MARKET",
        quantity=Decimal(str(qty)), mode=mode,
    )


# ---------------------------------------------------------------------------
# 1. Routing — primary adapter used
# ---------------------------------------------------------------------------

class TestRouting:
    @pytest.mark.asyncio
    async def test_primary_adapter_returns_order(self):
        order = _make_order()
        adapter = _make_adapter(order, "btcc")

        with patch("backend.engine.routing._get_ordered_adapters",
                   new=AsyncMock(return_value=[adapter])):
            routed = await route_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))

        assert routed.order.id == "test-001"
        assert routed.venue == "btcc"
        assert routed.attempts == 1
        adapter.create_order.assert_called_once()

    @pytest.mark.asyncio
    async def test_order_passes_correct_params_to_adapter(self):
        order = _make_order(side="SELL", fill_price=51_000.0)
        adapter = _make_adapter(order)

        with patch("backend.engine.routing._get_ordered_adapters",
                   new=AsyncMock(return_value=[adapter])):
            await route_order("ETHUSDT", "SELL", "MARKET", Decimal("0.5"))

        call_kwargs = adapter.create_order.call_args[1]
        assert call_kwargs["symbol"] == "ETHUSDT"
        assert call_kwargs["side"] == "SELL"
        assert call_kwargs["quantity"] == Decimal("0.5")


# ---------------------------------------------------------------------------
# 2. Retry / failover
# ---------------------------------------------------------------------------

class TestRetryFailover:
    @pytest.mark.asyncio
    async def test_retries_on_rate_limit(self):
        """Transient rate limit triggers retry on same adapter."""
        order = _make_order()
        call_count = 0

        async def create_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise AdapterRateLimitError("rate limited")
            return order

        adapter = MagicMock()
        adapter.create_order = AsyncMock(side_effect=create_side_effect)
        adapter.exchange_name = "test"

        with (
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.engine.routing.asyncio.sleep", new=AsyncMock()),
        ):
            routed = await route_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))

        assert routed.order.id == "test-001"
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_failover_to_secondary_after_primary_exhausted(self):
        primary = MagicMock()
        primary.create_order = AsyncMock(side_effect=AdapterUnavailableError("down"))
        primary.exchange_name = "primary"

        secondary = MagicMock()
        secondary.create_order = AsyncMock(return_value=_make_order(order_id="sec-001"))
        secondary.exchange_name = "secondary"

        with (
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[primary, secondary])),
            patch("backend.engine.routing.asyncio.sleep", new=AsyncMock()),
        ):
            routed = await route_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))

        assert routed.venue == "secondary"
        assert routed.order.id == "sec-001"

    @pytest.mark.asyncio
    async def test_execution_failed_when_all_venues_exhausted(self):
        adapter = MagicMock()
        adapter.create_order = AsyncMock(side_effect=AdapterUnavailableError("offline"))
        adapter.exchange_name = "test"

        with (
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.engine.routing.asyncio.sleep", new=AsyncMock()),
        ):
            with pytest.raises(ExecutionFailed) as exc_info:
                await route_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))

        assert "test" in exc_info.value.venue_errors

    @pytest.mark.asyncio
    async def test_hard_rejection_raises_execution_rejected(self):
        """Exchange hard-rejects order — must raise ExecutionRejected, not retry."""
        adapter = MagicMock()
        adapter.create_order = AsyncMock(side_effect=AdapterOrderError("insufficient balance"))
        adapter.exchange_name = "test"

        with patch("backend.engine.routing._get_ordered_adapters",
                   new=AsyncMock(return_value=[adapter])):
            with pytest.raises(ExecutionRejected, match="insufficient balance"):
                await route_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))

        # Hard rejection = 1 attempt only, no retry
        adapter.create_order.assert_called_once()


# ---------------------------------------------------------------------------
# 3. Blocked submission — kill switch
# ---------------------------------------------------------------------------

class TestKillSwitchBlocking:
    @pytest.mark.asyncio
    async def test_kill_switch_active_blocks_execution(self):
        with (
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=True)),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
        ):
            with pytest.raises(KillSwitchActive):
                await execute_intent(_intent())

    @pytest.mark.asyncio
    async def test_kill_switch_inactive_allows_execution(self):
        order = _make_order()
        adapter = _make_adapter(order)

        with (
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval",
                  new=AsyncMock(return_value=(True, "approved"))),
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
            patch("backend.engine.coordinator.record_heartbeat"),
        ):
            result = await execute_intent(_intent())

        assert result.status == "FILLED"

    @pytest.mark.asyncio
    async def test_kill_switch_route_returns_503(self, client: AsyncClient):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.intent.get_auth_config", return_value=mock_auth),
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=True)),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
        ):
            resp = await client.post("/intent/paper", json={
                "symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001
            })

        assert resp.status_code == 503
        assert resp.json()["detail"]["error"] == "kill_switch_active"


# ---------------------------------------------------------------------------
# 4. Risk gate blocking
# ---------------------------------------------------------------------------

class TestRiskGateBlocking:
    @pytest.mark.asyncio
    async def test_risk_gate_denied_raises_exception(self):
        with (
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval",
                  new=AsyncMock(return_value=(False, "Risk engine denied: decision=HOLD"))),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
        ):
            with pytest.raises(RiskGateDenied) as exc_info:
                await execute_intent(_intent())

        assert "HOLD" in exc_info.value.reason

    @pytest.mark.asyncio
    async def test_risk_gate_denied_returns_422(self, client: AsyncClient):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.intent.get_auth_config", return_value=mock_auth),
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval",
                  new=AsyncMock(return_value=(False, "risk denied"))),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
        ):
            resp = await client.post("/intent/paper", json={
                "symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001
            })

        assert resp.status_code == 422
        assert resp.json()["detail"]["error"] == "risk_gate_denied"


# ---------------------------------------------------------------------------
# 5. State updates after fill
# ---------------------------------------------------------------------------

class TestStateUpdates:
    def test_buy_fill_reduces_usdt_balance(self):
        reset_pnl_state(starting_balance=Decimal("10000"))
        process_fill("o1", "BTCUSDT", "BUY", Decimal("0.1"), Decimal("50000"), int(time.time()))
        balance = get_usdt_balance()
        assert balance == pytest.approx(Decimal("5000"), rel=1e-6)

    def test_sell_fill_increases_usdt_balance(self):
        reset_pnl_state(starting_balance=Decimal("5000"))
        # First buy
        process_fill("o1", "BTCUSDT", "BUY", Decimal("0.1"), Decimal("50000"), int(time.time()))
        # Then sell at higher price
        trade = process_fill("o2", "BTCUSDT", "SELL", Decimal("0.1"), Decimal("52000"), int(time.time()))
        assert trade is not None
        assert trade.realized_pnl > 0
        # Balance should have recovered + profit
        balance = get_usdt_balance()
        assert balance > Decimal("5000")


# ---------------------------------------------------------------------------
# 6. P&L computation
# ---------------------------------------------------------------------------

class TestPnLComputation:
    def test_realized_pnl_correct_for_winning_trade(self):
        reset_pnl_state()
        process_fill("b1", "ETHUSDT", "BUY",  Decimal("1"), Decimal("3000"), int(time.time()))
        trade = process_fill("s1", "ETHUSDT", "SELL", Decimal("1"), Decimal("3500"), int(time.time()))

        assert trade is not None
        assert float(trade.realized_pnl) == pytest.approx(500.0, rel=1e-5)
        assert trade.pnl_pct > 0

    def test_realized_pnl_correct_for_losing_trade(self):
        reset_pnl_state()
        process_fill("b2", "SOLUSDT", "BUY",  Decimal("10"), Decimal("100"), int(time.time()))
        trade = process_fill("s2", "SOLUSDT", "SELL", Decimal("10"), Decimal("90"),  int(time.time()))

        assert trade is not None
        assert float(trade.realized_pnl) == pytest.approx(-100.0, rel=1e-5)
        assert trade.pnl_pct < 0

    def test_fifo_lot_consumption(self):
        """FIFO: first lot bought is first lot sold."""
        reset_pnl_state()
        now = int(time.time())
        process_fill("b1", "BTCUSDT", "BUY", Decimal("0.5"), Decimal("40000"), now - 100)
        process_fill("b2", "BTCUSDT", "BUY", Decimal("0.5"), Decimal("50000"), now - 50)
        # Sell 0.5 — should consume first lot at 40000 cost
        trade = process_fill("s1", "BTCUSDT", "SELL", Decimal("0.5"), Decimal("55000"), now)
        assert trade is not None
        # P&L = (55000 - 40000) × 0.5 = 7500
        assert float(trade.realized_pnl) == pytest.approx(7500.0, rel=1e-5)

    @pytest.mark.asyncio
    async def test_pnl_summary_shape(self):
        reset_pnl_state()
        now = int(time.time())
        process_fill("b3", "ADAUSDT", "BUY",  Decimal("100"), Decimal("1.0"), now - 60)
        process_fill("s3", "ADAUSDT", "SELL", Decimal("100"), Decimal("1.2"), now)

        with patch("backend.engine.pnl.get_price",
                   new=AsyncMock(side_effect=Exception("not needed"))):
            summary = await get_pnl_summary()

        assert summary.trade_count == 1
        assert float(summary.total_realized_pnl) == pytest.approx(20.0, rel=1e-5)
        assert summary.win_rate_pct == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# 7. Intent route shape tests
# ---------------------------------------------------------------------------

class TestIntentRouteShapes:
    @pytest.mark.asyncio
    async def test_successful_paper_intent_returns_200(self, client: AsyncClient):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)
        order = _make_order()

        with (
            patch("backend.routes.intent.get_auth_config", return_value=mock_auth),
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval",
                  new=AsyncMock(return_value=(True, "approved"))),
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[_make_adapter(order)])),
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
            patch("backend.engine.coordinator.record_heartbeat"),
        ):
            resp = await client.post("/intent/paper", json={
                "symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001
            })

        assert resp.status_code == 200
        data = resp.json()
        for field in ["order_id", "status", "symbol", "side", "quantity",
                      "fill_price", "venue", "mode", "created_at"]:
            assert field in data, f"Missing field: {field}"
        assert data["mode"] == "paper"
        assert data["status"] == "FILLED"

    @pytest.mark.asyncio
    async def test_invalid_symbol_returns_400(self, client: AsyncClient):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)

        with (
            patch("backend.routes.intent.get_auth_config", return_value=mock_auth),
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
        ):
            resp = await client.post("/intent/paper", json={
                "symbol": "FAKECOIN", "side": "BUY", "quantity": 0.001
            })

        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_live_and_paper_use_same_pipeline(self, client: AsyncClient):
        """Both /intent/paper and /intent/live route through the same coordinator."""
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key=None, auth_enabled=False)
        order = _make_order()

        common_patches = {
            "backend.routes.intent.get_auth_config": mock_auth,
            "backend.engine.coordinator.is_kill_switch_active": AsyncMock(return_value=False),
            "backend.engine.coordinator._check_risk_approval": AsyncMock(return_value=(True, "approved")),
            "backend.engine.routing._get_ordered_adapters": AsyncMock(return_value=[_make_adapter(order)]),
            "backend.engine.coordinator._publish_order_update": AsyncMock(),
            "backend.engine.coordinator._append_audit_entry": AsyncMock(),
        }

        with (
            patch("backend.routes.intent.get_auth_config", return_value=mock_auth),
            patch("backend.engine.coordinator.is_kill_switch_active", new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval", new=AsyncMock(return_value=(True, "approved"))),
            patch("backend.engine.routing._get_ordered_adapters", new=AsyncMock(return_value=[_make_adapter(order)])),
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
            patch("backend.engine.coordinator.record_heartbeat"),
        ):
            paper_resp = await client.post("/intent/paper", json={"symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001})
            live_resp  = await client.post("/intent/live",  json={"symbol": "BTCUSDT", "side": "BUY", "quantity": 0.001})

        assert paper_resp.status_code == 200
        assert live_resp.status_code  == 200
        # Mode field differs
        assert paper_resp.json()["mode"] == "paper"
        assert live_resp.json()["mode"]  == "live"


# ---------------------------------------------------------------------------
# 8. No simulated fills — adapter is always called
# ---------------------------------------------------------------------------

class TestNoSimulatedFills:
    @pytest.mark.asyncio
    async def test_adapter_create_order_always_called(self):
        """Confirms execution goes through adapter, not a simulated path."""
        order = _make_order()
        adapter = _make_adapter(order)

        with (
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval",
                  new=AsyncMock(return_value=(True, "approved"))),
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
            patch("backend.engine.coordinator.record_heartbeat"),
        ):
            await execute_intent(_intent())

        # The adapter's create_order MUST have been called
        adapter.create_order.assert_called_once()
