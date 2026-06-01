# tests/adapters/test_live_adapter.py
"""
Audit proof: LiveAdapter raises NotImplementedError on every method.
No live orders can ever be placed through this adapter.
"""
import pytest
from decimal import Decimal
from backend.adapters.exchanges.live import LiveAdapter, _DISABLED_MSG


@pytest.fixture
def adapter():
    return LiveAdapter()


def test_name_raises(adapter):
    with pytest.raises(NotImplementedError, match="permanently disabled"):
        _ = adapter.name


def test_network_raises(adapter):
    with pytest.raises(NotImplementedError, match="permanently disabled"):
        _ = adapter.network


@pytest.mark.asyncio
async def test_exchange_status_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.exchange_status()


@pytest.mark.asyncio
async def test_fetch_ticker_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.fetch_ticker("BTCUSDT")


@pytest.mark.asyncio
async def test_fetch_ohlcv_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.fetch_ohlcv("BTCUSDT")


@pytest.mark.asyncio
async def test_fetch_balance_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.fetch_balance()


@pytest.mark.asyncio
async def test_fetch_positions_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.fetch_positions()


@pytest.mark.asyncio
async def test_create_order_raises(adapter):
    """Critical: proves no real order can ever be placed."""
    with pytest.raises(NotImplementedError):
        await adapter.create_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))


@pytest.mark.asyncio
async def test_cancel_order_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.cancel_order("BTCUSDT", "order123")


@pytest.mark.asyncio
async def test_fetch_order_raises(adapter):
    with pytest.raises(NotImplementedError):
        await adapter.fetch_order("BTCUSDT", "order123")


def test_disabled_message_is_clear():
    """Sanity: the disabled message explicitly states live orders are blocked."""
    assert "permanently disabled" in _DISABLED_MSG
    assert "PaperAdapter" in _DISABLED_MSG
