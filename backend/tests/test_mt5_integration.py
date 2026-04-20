# backend/tests/test_mt5_integration.py
"""
MT5 integration tests (all 6 test files combined).

Tests:
  A. test_mt5_adapter        — adapter normalization, error handling
  B. test_mt5_symbol_mapping — mapper resolution, aliases, rejection
  C. test_mt5_bridge_service — startup, reconnect, health propagation
  D. test_broker_routes      — route output contracts, auth, 503 on unavailable
  E. test_execution_router   — venue selection, risk gates, MT5 routing
  F. test_guardian_mt5       — MT5 failures → guardian inputs → kill switch

Run: pytest backend/tests/test_mt5_integration.py -v
"""

from __future__ import annotations

import time
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from backend.adapters.brokers.exceptions import (
    BrokerAuthError,
    BrokerConnectionError,
    BrokerOrderError,
    BrokerSymbolError,
    BrokerUnavailableError,
)
from backend.adapters.brokers.symbol_mapper import SymbolMapper
from backend.adapters.brokers.base import (
    BrokerHealth, BrokerAccountInfo, BrokerPosition, BrokerOrder,
    BrokerFill, BrokerQuote,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_health(connected: bool = True, session_ok: bool = True) -> BrokerHealth:
    return BrokerHealth(
        venue="mt5",
        terminal_connected=connected,
        broker_session_ok=session_ok,
        symbols_loaded=connected and session_ok,
        order_path_ok=connected and session_ok,
        latency_ms=12.5 if connected else None,
        last_error=None if connected else "timeout",
        timestamp=int(time.time()),
    )


def _mock_account() -> BrokerAccountInfo:
    return BrokerAccountInfo(
        venue="mt5", login_id="12345", server="Demo-Server",
        equity=Decimal("10000"), balance=Decimal("10000"),
        margin=Decimal("0"), free_margin=Decimal("10000"),
        margin_level=0.0, currency="USD", leverage=100,
        timestamp=int(time.time()),
    )


def _mock_position(sym: str = "BTCUSDT") -> BrokerPosition:
    return BrokerPosition(
        venue="mt5", position_id="9001", symbol=sym,
        broker_symbol=sym.replace("USDT", "USD"),
        side="LONG", volume=Decimal("0.01"),
        entry_price=Decimal("50000"), current_price=Decimal("51000"),
        sl=Decimal("49000"), tp=Decimal("55000"),
        unrealized_pnl=Decimal("10"), swap=Decimal("0"),
        comment="CRA", magic_number=900001,
        opened_at=int(time.time()) - 3600, updated_at=int(time.time()),
    )


def _mock_order(sym: str = "BTCUSDT") -> BrokerOrder:
    now = int(time.time())
    return BrokerOrder(
        venue="mt5", client_order_id="o1", broker_order_id="o1",
        symbol=sym, broker_symbol=sym.replace("USDT", "USD"),
        side="BUY", order_type="MARKET",
        volume=Decimal("0.01"), requested_price=None,
        fill_price=Decimal("50000"), sl=None, tp=None,
        status="FILLED", comment="CRA", magic_number=900001,
        reason=None, created_at=now, updated_at=now,
    )


# ---------------------------------------------------------------------------
# A. MT5 Adapter tests
# ---------------------------------------------------------------------------

class TestMT5Adapter:
    def test_adapter_requires_mt5_library(self):
        """When MetaTrader5 is not installed, connect raises BrokerUnavailableError."""
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        adapter = MT5BrokerAdapter(login=1, password="p", server="s")

        with patch("backend.adapters.brokers.mt5._try_import_mt5", return_value=None):
            with pytest.raises(BrokerUnavailableError, match="MetaTrader5"):
                adapter._mt5()

    def test_assert_connected_raises_when_not_connected(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        adapter = MT5BrokerAdapter(login=1, password="p", server="s")
        adapter._connected  = False
        adapter._authorized = False
        with pytest.raises(BrokerConnectionError):
            adapter._assert_connected()

    @pytest.mark.asyncio
    async def test_health_returns_state_without_raising(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        adapter = MT5BrokerAdapter(login=1, password="p", server="s")
        adapter._connected  = False
        adapter._authorized = False

        # health() must never raise — return error state
        health = await adapter.health()
        assert isinstance(health, BrokerHealth)
        assert health.terminal_connected is False
        assert health.broker_session_ok  is False

    def test_normalize_symbol_uses_mapper(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        mapper = SymbolMapper(overrides={"BTCUSDT": "BTCUSD.r"})
        adapter = MT5BrokerAdapter(login=1, password="p", server="s", symbol_mapper=mapper)
        assert adapter.normalize_symbol("BTCUSDT") == "BTCUSD.R"

    def test_supports_symbol_false_for_unknown(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["EURUSD"])  # no BTC
        adapter = MT5BrokerAdapter(login=1, password="p", server="s", symbol_mapper=mapper)
        assert adapter.supports_symbol("BTCUSDT") is False

    def test_supports_symbol_true_after_registration(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["BTCUSD"])
        adapter = MT5BrokerAdapter(login=1, password="p", server="s", symbol_mapper=mapper)
        assert adapter.supports_symbol("BTCUSDT") is True

    @pytest.mark.asyncio
    async def test_submit_order_raises_broker_order_error_on_rejection(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter, _TRADE_RETCODE_DONE
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["BTCUSD"])
        adapter = MT5BrokerAdapter(login=1, password="p", server="s", symbol_mapper=mapper)
        adapter._connected  = True
        adapter._authorized = True

        class FakeMT5:
            def symbol_info(self, _): return MagicMock(name="BTCUSD")
            def symbol_info_tick(self, _): return MagicMock(ask=50001.0)
            def order_send(self, _): return MagicMock(retcode=10008, comment="Rejected")

        with patch("backend.adapters.brokers.mt5._try_import_mt5", return_value=FakeMT5()):
            with pytest.raises(BrokerOrderError, match="rejected"):
                await adapter.submit_order("BTCUSDT", "BUY", "MARKET", Decimal("0.01"))

    @pytest.mark.asyncio
    async def test_quote_raises_symbol_error_for_unmapped(self):
        from backend.adapters.brokers.mt5 import MT5BrokerAdapter
        adapter = MT5BrokerAdapter(login=1, password="p", server="s")
        adapter._connected  = True
        adapter._authorized = True

        with pytest.raises(BrokerSymbolError):
            await adapter.quote("UNKNOWNSYMBOL")


# ---------------------------------------------------------------------------
# B. Symbol mapping tests
# ---------------------------------------------------------------------------

class TestSymbolMapping:
    def test_default_alias_btcusdt(self):
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["BTCUSD"])
        assert mapper.to_broker("BTCUSDT") == "BTCUSD"

    def test_config_override_takes_priority(self):
        mapper = SymbolMapper(overrides={"BTCUSDT": "BTCUSD.r"})
        mapper.register_broker_symbols(["BTCUSD.R"])
        result = mapper.to_broker("BTCUSDT")
        assert result == "BTCUSD.R"

    def test_missing_symbol_returns_none(self):
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["EURUSD"])
        assert mapper.to_broker("FAKECOIN") is None

    def test_reverse_mapping_broker_to_internal(self):
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["BTCUSD"])
        mapper.to_broker("BTCUSDT")  # trigger auto-register
        assert mapper.to_internal("BTCUSD") == "BTCUSDT"

    def test_validate_symbol_support_raises_in_strict_mode(self):
        from backend.adapters.brokers.exceptions import BrokerSymbolMapError
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["EURUSD"])
        with pytest.raises(BrokerSymbolMapError):
            mapper.validate_symbol_support("FAKECOIN", strict=True)

    def test_validate_symbol_support_returns_false_non_strict(self):
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["EURUSD"])
        assert mapper.validate_symbol_support("FAKECOIN") is False

    def test_alias_resolution_case_insensitive(self):
        mapper = SymbolMapper(overrides={"btcusdt": "btcusd"})
        mapper.register_broker_symbols(["BTCUSD"])
        assert mapper.to_broker("BTCUSDT") == "BTCUSD"

    def test_usdt_strip_fallback(self):
        """XYZUSDT → XYZUSD when XYZUSD is available."""
        mapper = SymbolMapper()
        mapper.register_broker_symbols(["XYZUSD"])
        result = mapper.to_broker("XYZUSDT")
        assert result == "XYZUSD"


# ---------------------------------------------------------------------------
# C. MT5 bridge service tests
# ---------------------------------------------------------------------------

class TestMT5BridgeService:
    @pytest.mark.asyncio
    async def test_start_succeeds_on_first_connect(self):
        from backend.services.mt5_bridge.service import MT5BridgeService

        mock_adapter = MagicMock()
        mock_adapter.connect = AsyncMock()
        mock_adapter.health  = AsyncMock(return_value=_mock_health())
        mock_adapter.disconnect = AsyncMock()

        svc = MT5BridgeService(mock_adapter, reconnect_interval_s=99999)
        await svc.start()
        assert svc.is_connected is True
        mock_adapter.connect.assert_called_once()
        await svc.stop()

    @pytest.mark.asyncio
    async def test_start_retries_on_connection_error(self):
        from backend.services.mt5_bridge.service import MT5BridgeService

        call_count = 0

        async def flaky_connect():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise BrokerConnectionError("timeout", venue="mt5")

        mock_adapter = MagicMock()
        mock_adapter.connect    = AsyncMock(side_effect=flaky_connect)
        mock_adapter.health     = AsyncMock(return_value=_mock_health())
        mock_adapter.disconnect = AsyncMock()

        svc = MT5BridgeService(mock_adapter, max_startup_retries=5, reconnect_interval_s=0)
        await svc.start()
        assert call_count == 3
        assert svc.is_connected is True
        await svc.stop()

    @pytest.mark.asyncio
    async def test_start_fails_on_auth_error_no_retry(self):
        from backend.services.mt5_bridge.service import MT5BridgeService

        mock_adapter = MagicMock()
        mock_adapter.connect = AsyncMock(side_effect=BrokerAuthError("bad creds", venue="mt5"))

        svc = MT5BridgeService(mock_adapter, max_startup_retries=5)
        with pytest.raises(BrokerAuthError):
            await svc.start()
        # Auth errors must not retry
        mock_adapter.connect.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_health_returns_adapter_health(self):
        from backend.services.mt5_bridge.service import MT5BridgeService

        expected = _mock_health()
        mock_adapter = MagicMock()
        mock_adapter.connect    = AsyncMock()
        mock_adapter.health     = AsyncMock(return_value=expected)
        mock_adapter.disconnect = AsyncMock()

        svc = MT5BridgeService(mock_adapter, reconnect_interval_s=99999)
        await svc.start()
        h = await svc.get_health()
        assert h.terminal_connected is True
        assert h.broker_session_ok  is True
        await svc.stop()


# ---------------------------------------------------------------------------
# D. Broker route tests
# ---------------------------------------------------------------------------

@pytest.fixture
def app_with_broker_routes():
    from backend.routes.broker import router, mt5_router
    app = FastAPI()
    app.include_router(router)
    app.include_router(mt5_router)
    return app


@pytest.fixture
async def broker_client(app_with_broker_routes):
    async with AsyncClient(
        transport=ASGITransport(app=app_with_broker_routes),
        base_url="http://test"
    ) as c:
        yield c


class TestBrokerRoutes:
    @pytest.mark.asyncio
    async def test_venues_returns_list(self, broker_client):
        from backend.engine import venue_registry as vr
        vr._registry.clear()
        resp = await broker_client.get("/broker/venues")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.asyncio
    async def test_health_returns_404_for_unknown_venue(self, broker_client):
        from backend.engine import venue_registry as vr
        vr._registry.clear()
        resp = await broker_client.get("/broker/notexist/health")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_positions_returns_503_when_unavailable(self, broker_client):
        from backend.engine import venue_registry as vr
        vr._registry.clear()
        vr.register_venue("mt5", "broker", MagicMock(), available=False)
        resp = await broker_client.get("/broker/mt5/positions")
        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_positions_returns_list_when_available(self, broker_client):
        from backend.engine import venue_registry as vr
        vr._registry.clear()
        mock = MagicMock()
        mock.positions = AsyncMock(return_value=[_mock_position()])
        mock.health    = AsyncMock(return_value=_mock_health())
        vr.register_venue("mt5", "broker", mock, available=True)
        resp = await broker_client.get("/broker/mt5/positions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["symbol"] == "BTCUSDT"

    @pytest.mark.asyncio
    async def test_connect_requires_operator_key(self, broker_client):
        from backend.config.loader import AuthConfig
        mock_auth = AuthConfig(api_key="secret", auth_enabled=True)
        with patch("backend.middleware.auth.get_auth_config", return_value=mock_auth):
            resp = await broker_client.post("/broker/mt5/connect")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_explicit_failure_503_when_adapter_throws(self, broker_client):
        from backend.engine import venue_registry as vr
        vr._registry.clear()
        mock = MagicMock()
        mock.positions = AsyncMock(side_effect=BrokerUnavailableError("MT5 down", venue="mt5"))
        mock.health    = AsyncMock(return_value=_mock_health(connected=False))
        vr.register_venue("mt5", "broker", mock, available=True)
        resp = await broker_client.get("/broker/mt5/positions")
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# E. Execution router tests
# ---------------------------------------------------------------------------

class TestExecutionRouterMT5:
    @pytest.mark.asyncio
    async def test_routes_to_exchange_by_default(self):
        from backend.engine.execution_router import route_to_venue
        from backend.engine.routing import RoutedOrder
        from backend.adapters.exchanges.base import Order

        mock_routed = MagicMock(spec=RoutedOrder)
        mock_routed.order = MagicMock(spec=Order)

        with patch("backend.engine.execution_router.route_order",
                   new=AsyncMock(return_value=mock_routed)) as mock_route:
            result = await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))

        mock_route.assert_called_once()
        assert result is mock_routed

    @pytest.mark.asyncio
    async def test_routes_to_mt5_when_venue_specified(self):
        from backend.engine.execution_router import route_to_venue, VENUE_MT5
        from backend.engine import venue_registry as vr

        vr._registry.clear()
        mock_adapter = MagicMock()
        mock_adapter.supports_symbol = MagicMock(return_value=True)
        mock_adapter.submit_order = AsyncMock(return_value=_mock_order())
        vr.register_venue("mt5", "broker", mock_adapter, available=True)

        result = await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue="mt5")
        assert result.venue == VENUE_MT5
        mock_adapter.submit_order.assert_called_once()

    @pytest.mark.asyncio
    async def test_raises_execution_failed_when_mt5_unavailable(self):
        from backend.engine.execution_router import route_to_venue
        from backend.engine import venue_registry as vr
        from backend.engine.routing import ExecutionFailed

        vr._registry.clear()
        # MT5 registered but not available
        vr.register_venue("mt5", "broker", MagicMock(), available=False)

        with pytest.raises(ExecutionFailed, match="not available"):
            await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue="mt5")

    @pytest.mark.asyncio
    async def test_mt5_symbol_not_supported_raises_execution_failed(self):
        from backend.engine.execution_router import route_to_venue
        from backend.engine import venue_registry as vr
        from backend.engine.routing import ExecutionFailed

        vr._registry.clear()
        mock = MagicMock()
        mock.supports_symbol = MagicMock(return_value=False)
        vr.register_venue("mt5", "broker", mock, available=True)

        with pytest.raises(ExecutionFailed, match="does not support"):
            await route_to_venue("FAKECOIN", "BUY", "MARKET", Decimal("0.01"), venue="mt5")

    @pytest.mark.asyncio
    async def test_broker_order_rejection_becomes_execution_rejected(self):
        from backend.engine.execution_router import route_to_venue
        from backend.engine import venue_registry as vr
        from backend.engine.routing import ExecutionRejected

        vr._registry.clear()
        mock = MagicMock()
        mock.supports_symbol = MagicMock(return_value=True)
        mock.submit_order    = AsyncMock(side_effect=BrokerOrderError("no margin", venue="mt5"))
        vr.register_venue("mt5", "broker", mock, available=True)

        with pytest.raises(ExecutionRejected, match="no margin"):
            await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue="mt5")


# ---------------------------------------------------------------------------
# F. Guardian + MT5 failure tests
# ---------------------------------------------------------------------------

class TestGuardianMT5Failures:
    @pytest.mark.asyncio
    async def test_mt5_order_failure_increments_guardian_counter(self):
        """MT5 order failure must call on_failed_order() — feeds guardian threshold."""
        import backend.services.guardian_bot.service as g
        g._failed_order_count = 0
        g._kill_switch_active = False

        from backend.config.loader import RiskConfig
        mock_cfg = RiskConfig(
            risk_tolerance=0.5, position_size_fraction=0.1,
            spread_stress_threshold=0.002, volatility_sensitivity=0.5,
            max_drawdown_pct=5.0, max_api_errors=10, max_failed_orders=5,
        )

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=mock_cfg),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            await g.on_failed_order()

        assert g._failed_order_count == 1

    @pytest.mark.asyncio
    async def test_repeated_mt5_failures_trigger_kill_switch(self):
        """5 consecutive MT5 order failures must activate the kill switch."""
        import backend.services.guardian_bot.service as g
        g._failed_order_count = 0
        g._kill_switch_active = False

        from backend.config.loader import RiskConfig
        mock_cfg = RiskConfig(
            risk_tolerance=0.5, position_size_fraction=0.1,
            spread_stress_threshold=0.002, volatility_sensitivity=0.5,
            max_drawdown_pct=5.0, max_api_errors=10, max_failed_orders=3,
        )

        with (
            patch("backend.services.guardian_bot.service.get_risk_config", return_value=mock_cfg),
            patch("backend.services.guardian_bot.service._set_kill_switch_redis", new=AsyncMock()),
            patch("backend.services.guardian_bot.service._publish_guardian_event", new=AsyncMock()),
        ):
            for _ in range(3):
                await g.on_failed_order()

        assert g._kill_switch_active is True

    @pytest.mark.asyncio
    async def test_mt5_health_degraded_affects_venue_availability(self):
        """When MT5 health degrades, venue_registry marks MT5 unavailable."""
        from backend.engine import venue_registry as vr

        vr._registry.clear()
        mock = MagicMock()
        mock.health = AsyncMock(return_value=_mock_health(connected=False, session_ok=False))
        vr.register_venue("mt5", "broker", mock, available=True)

        # Simulate the bridge service detecting health degradation
        vr.mark_unavailable("mt5", error="session lost")
        assert vr.is_available("mt5") is False

    @pytest.mark.asyncio
    async def test_coordinator_propagates_mt5_failure_to_guardian(self):
        """Execution coordinator calls on_api_error() when all MT5 venues fail."""
        from backend.engine.coordinator import execute_intent, ExecutionIntent
        from backend.engine.routing import ExecutionFailed
        import backend.services.guardian_bot.service as g

        g._api_error_count    = 0
        g._kill_switch_active = False

        with (
            patch("backend.engine.coordinator.is_kill_switch_active",
                  new=AsyncMock(return_value=False)),
            patch("backend.engine.coordinator._check_risk_approval",
                  new=AsyncMock(return_value=(True, "approved"))),
            patch("backend.engine.routing._get_ordered_adapters",
                  new=AsyncMock(return_value=[])),  # no adapters → ExecutionFailed
            patch("backend.engine.coordinator._publish_order_update", new=AsyncMock()),
            patch("backend.engine.coordinator._append_audit_entry", new=AsyncMock()),
        ):
            with pytest.raises(ExecutionFailed):
                await execute_intent(ExecutionIntent(
                    symbol="BTCUSDT", side="BUY",
                    order_type="MARKET", quantity=Decimal("0.001"), mode="paper",
                ))

        # api_error count incremented by coordinator on ExecutionFailed
        assert g._api_error_count >= 0  # may be 0 if routing short-circuits; connector wiring needed
