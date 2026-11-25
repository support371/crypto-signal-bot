"""Tests for backend.engine.execution_router — venue routing logic."""

from __future__ import annotations

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from backend.engine.execution_router import (
    BrokerRoutedOrder,
    VENUE_EXCHANGE,
    VENUE_MT5,
    route_to_venue,
)
from backend.engine.routing import ExecutionFailed, ExecutionRejected, RoutedOrder
from backend.adapters.exchanges.base import Order


def _make_order(**overrides) -> Order:
    defaults = dict(
        id="ord-1", symbol="BTCUSDT", side="BUY", order_type="MARKET",
        quantity=Decimal("0.01"), price=None, fill_price=Decimal("97000"),
        filled_qty=Decimal("0.01"), status="FILLED",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:01Z",
        exchange_order_id="ex-ord-1",
    )
    defaults.update(overrides)
    return Order(**defaults)


def _make_broker_order(**overrides) -> MagicMock:
    bo = MagicMock()
    bo.broker_order_id = overrides.get("broker_order_id", "mt5-ord-1")
    bo.symbol = overrides.get("symbol", "BTCUSDT")
    bo.side = overrides.get("side", "BUY")
    bo.order_type = overrides.get("order_type", "MARKET")
    bo.volume = overrides.get("volume", Decimal("0.01"))
    bo.requested_price = overrides.get("requested_price", 97000.0)
    bo.fill_price = overrides.get("fill_price", 97050.0)
    bo.status = overrides.get("status", "FILLED")
    bo.created_at = overrides.get("created_at", "2026-01-01T00:00:00Z")
    bo.updated_at = overrides.get("updated_at", "2026-01-01T00:00:01Z")
    return bo


class TestRouteToVenueExchange:
    """Tests for exchange venue routing (default path)."""

    @pytest.mark.asyncio
    async def test_default_routes_to_exchange(self):
        routed = RoutedOrder(order=_make_order(), venue="paper", attempts=1, elapsed_ms=50)
        with patch("backend.engine.execution_router.route_order", new_callable=AsyncMock, return_value=routed):
            result = await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"))
        assert isinstance(result, RoutedOrder)
        assert result.order.status == "FILLED"

    @pytest.mark.asyncio
    async def test_explicit_exchange_venue(self):
        routed = RoutedOrder(order=_make_order(), venue="paper", attempts=1, elapsed_ms=30)
        with patch("backend.engine.execution_router.route_order", new_callable=AsyncMock, return_value=routed):
            result = await route_to_venue("ETHUSDT", "SELL", "LIMIT", Decimal("1.0"), venue=VENUE_EXCHANGE)
        assert isinstance(result, RoutedOrder)

    @pytest.mark.asyncio
    async def test_exchange_failure_propagates(self):
        with patch(
            "backend.engine.execution_router.route_order",
            new_callable=AsyncMock,
            side_effect=ExecutionFailed("All venues failed"),
        ):
            with pytest.raises(ExecutionFailed, match="All venues failed"):
                await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"))

    @pytest.mark.asyncio
    async def test_exchange_rejection_propagates(self):
        with patch(
            "backend.engine.execution_router.route_order",
            new_callable=AsyncMock,
            side_effect=ExecutionRejected("Insufficient margin"),
        ):
            with pytest.raises(ExecutionRejected, match="Insufficient margin"):
                await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"))


class TestRouteToVenueMT5:
    """Tests for MT5 broker venue routing."""

    @pytest.mark.asyncio
    async def test_mt5_unavailable_raises(self):
        with patch("backend.engine.execution_router.is_available", return_value=False):
            with pytest.raises(ExecutionFailed, match="MT5 venue is not available"):
                await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue=VENUE_MT5)

    @pytest.mark.asyncio
    async def test_mt5_unsupported_symbol_raises(self):
        mock_adapter = MagicMock()
        mock_adapter.supports_symbol.return_value = False
        mock_venue_info = MagicMock(adapter=mock_adapter)

        with patch("backend.engine.execution_router.is_available", return_value=True), \
             patch("backend.engine.execution_router.get_venue", return_value=mock_venue_info):
            with pytest.raises(ExecutionFailed, match="MT5 does not support symbol"):
                await route_to_venue("INVALIDPAIR", "BUY", "MARKET", Decimal("0.01"), venue=VENUE_MT5)

    @pytest.mark.asyncio
    async def test_mt5_successful_order(self):
        mock_adapter = MagicMock()
        mock_adapter.supports_symbol.return_value = True
        mock_adapter.submit_order = AsyncMock(return_value=_make_broker_order())
        mock_venue_info = MagicMock(adapter=mock_adapter)

        with patch("backend.engine.execution_router.is_available", return_value=True), \
             patch("backend.engine.execution_router.get_venue", return_value=mock_venue_info):
            result = await route_to_venue(
                "BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue=VENUE_MT5,
            )
        assert isinstance(result, BrokerRoutedOrder)
        assert result.venue == VENUE_MT5
        assert result.order.status == "FILLED"
        assert result.order.id == "mt5-ord-1"

    @pytest.mark.asyncio
    async def test_mt5_order_rejection(self):
        from backend.adapters.brokers.exceptions import BrokerOrderError

        mock_adapter = MagicMock()
        mock_adapter.supports_symbol.return_value = True
        mock_adapter.submit_order = AsyncMock(side_effect=BrokerOrderError("margin"))
        mock_venue_info = MagicMock(adapter=mock_adapter)

        with patch("backend.engine.execution_router.is_available", return_value=True), \
             patch("backend.engine.execution_router.get_venue", return_value=mock_venue_info):
            with pytest.raises(ExecutionRejected, match="MT5 rejected"):
                await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue=VENUE_MT5)

    @pytest.mark.asyncio
    async def test_mt5_unavailable_error(self):
        from backend.adapters.brokers.exceptions import BrokerUnavailableError

        mock_adapter = MagicMock()
        mock_adapter.supports_symbol.return_value = True
        mock_adapter.submit_order = AsyncMock(side_effect=BrokerUnavailableError("timeout"))
        mock_venue_info = MagicMock(adapter=mock_adapter)

        with patch("backend.engine.execution_router.is_available", return_value=True), \
             patch("backend.engine.execution_router.get_venue", return_value=mock_venue_info):
            with pytest.raises(ExecutionFailed, match="MT5 venue failed"):
                await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue=VENUE_MT5)

    @pytest.mark.asyncio
    async def test_mt5_auth_error(self):
        from backend.adapters.brokers.exceptions import BrokerAuthError

        mock_adapter = MagicMock()
        mock_adapter.supports_symbol.return_value = True
        mock_adapter.submit_order = AsyncMock(side_effect=BrokerAuthError("creds"))
        mock_venue_info = MagicMock(adapter=mock_adapter)

        with patch("backend.engine.execution_router.is_available", return_value=True), \
             patch("backend.engine.execution_router.get_venue", return_value=mock_venue_info):
            with pytest.raises(ExecutionFailed, match="MT5 venue failed"):
                await route_to_venue("BTCUSDT", "BUY", "MARKET", Decimal("0.01"), venue=VENUE_MT5)


class TestBrokerRoutedOrderNormalization:
    """Tests for BrokerRoutedOrder shape normalization."""

    def test_normalized_order_has_exchange_shape(self):
        bo = _make_broker_order()
        result = BrokerRoutedOrder(broker_order=bo, venue="mt5", attempts=1, elapsed_ms=100)
        assert result.order.id == "mt5-ord-1"
        assert result.order.symbol == "BTCUSDT"
        assert result.order.side == "BUY"
        assert result.order.status == "FILLED"
        assert result.order.fill_price == Decimal("97050.0")

    def test_unfilled_order_has_zero_filled_qty(self):
        bo = _make_broker_order(status="PENDING")
        result = BrokerRoutedOrder(broker_order=bo, venue="mt5", attempts=1, elapsed_ms=50)
        assert result.order.filled_qty == Decimal("0")

    def test_no_price_produces_none(self):
        bo = _make_broker_order(requested_price=None, fill_price=None)
        result = BrokerRoutedOrder(broker_order=bo, venue="mt5", attempts=1, elapsed_ms=50)
        assert result.order.price is None
        assert result.order.fill_price is None
