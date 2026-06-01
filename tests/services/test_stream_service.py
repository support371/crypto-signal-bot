# tests/services/test_stream_service.py
"""
Tests for StreamManager typed event broadcasting.
"""
import asyncio
import pytest
import time
from unittest.mock import AsyncMock, MagicMock
from backend.services.stream_service import StreamManager, StreamClient, HEARTBEAT_INTERVAL_S


def _make_ws():
    ws = MagicMock()
    ws.send_json = AsyncMock(return_value=None)
    ws.accept = AsyncMock(return_value=None)
    return ws


@pytest.fixture
def manager():
    return StreamManager()


@pytest.mark.asyncio
async def test_connect_adds_client(manager):
    ws = _make_ws()
    client = await manager.connect(ws)
    assert manager.client_count == 1
    assert isinstance(client, StreamClient)


@pytest.mark.asyncio
async def test_disconnect_removes_client(manager):
    ws = _make_ws()
    client = await manager.connect(ws)
    manager.disconnect(client)
    assert manager.client_count == 0


@pytest.mark.asyncio
async def test_broadcast_sends_to_all(manager):
    ws1, ws2 = _make_ws(), _make_ws()
    await manager.connect(ws1)
    await manager.connect(ws2)
    await manager.broadcast({"type": "test", "value": 42})
    ws1.send_json.assert_awaited_once()
    ws2.send_json.assert_awaited_once()


@pytest.mark.asyncio
async def test_broadcast_prunes_dead_clients(manager):
    ws = _make_ws()
    ws.send_json = AsyncMock(side_effect=Exception("disconnected"))
    await manager.connect(ws)
    assert manager.client_count == 1
    await manager.broadcast({"type": "test"})
    assert manager.client_count == 0


@pytest.mark.asyncio
async def test_broadcast_ticker_schema(manager):
    ws = _make_ws()
    await manager.connect(ws)
    await manager.broadcast_ticker("BTCUSDT", 65000.0, 1.5, 123456.0)
    call_args = ws.send_json.call_args[0][0]
    assert call_args["type"] == "ticker"
    assert call_args["symbol"] == "BTCUSDT"
    assert call_args["price"] == 65000.0
    assert call_args["change24h"] == 1.5
    assert "ts" in call_args


@pytest.mark.asyncio
async def test_broadcast_signal_schema(manager):
    ws = _make_ws()
    await manager.connect(ws)
    await manager.broadcast_signal("ETHUSDT", "BUY", 0.8765, "trend_v1")
    call_args = ws.send_json.call_args[0][0]
    assert call_args["type"] == "signal"
    assert call_args["symbol"] == "ETHUSDT"
    assert call_args["side"] == "BUY"
    assert call_args["confidence"] == 0.8765
    assert call_args["strategy_id"] == "trend_v1"


@pytest.mark.asyncio
async def test_broadcast_portfolio_schema(manager):
    ws = _make_ws()
    await manager.connect(ws)
    await manager.broadcast_portfolio(10500.0, 9000.0, 5.0, 2)
    call_args = ws.send_json.call_args[0][0]
    assert call_args["type"] == "portfolio"
    assert call_args["equity"] == 10500.0
    assert call_args["open_positions"] == 2


@pytest.mark.asyncio
async def test_broadcast_guardian_schema(manager):
    ws = _make_ws()
    await manager.connect(ws)
    await manager.broadcast_guardian(False, False, 3.5)
    call_args = ws.send_json.call_args[0][0]
    assert call_args["type"] == "guardian"
    assert call_args["triggered"] is False
    assert call_args["drawdown_pct"] == 3.5


# --- Symbol subscription filter ---

@pytest.mark.asyncio
async def test_subscription_filter_ticker(manager):
    ws = _make_ws()
    client = await manager.connect(ws)
    client.subscribed_symbols = {"BTCUSDT"}
    # Should receive BTCUSDT
    await manager.broadcast_ticker("BTCUSDT", 65000.0, 1.0, 0.0)
    assert ws.send_json.await_count == 1
    # Should NOT receive ETHUSDT
    await manager.broadcast_ticker("ETHUSDT", 3000.0, 0.5, 0.0)
    assert ws.send_json.await_count == 1  # still 1


@pytest.mark.asyncio
async def test_no_subscription_gets_all(manager):
    ws = _make_ws()
    client = await manager.connect(ws)
    assert client.subscribed_symbols is None  # default = all
    await manager.broadcast_ticker("BTCUSDT", 65000.0, 1.0, 0.0)
    await manager.broadcast_ticker("ETHUSDT", 3000.0, 0.5, 0.0)
    assert ws.send_json.await_count == 2


def test_heartbeat_interval_is_reasonable():
    assert 10 <= HEARTBEAT_INTERVAL_S <= 60
