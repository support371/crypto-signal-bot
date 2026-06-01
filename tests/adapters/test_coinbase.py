# tests/adapters/test_coinbase.py
"""
Coinbase adapter contract tests.
Tests market data availability and confirms live execution is disabled.
"""
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from backend.adapters.exchanges.coinbase import CoinbaseAdapter, _to_coinbase_symbol


@pytest.fixture
def adapter():
    return CoinbaseAdapter(timeout=5.0)


# --- Symbol mapping ---

def test_symbol_map_btc():
    assert _to_coinbase_symbol("BTCUSDT") == "BTC-USDT"

def test_symbol_map_eth():
    assert _to_coinbase_symbol("ETHUSDT") == "ETH-USDT"

def test_symbol_map_fallback():
    assert _to_coinbase_symbol("LINKUSDT") == "LINK-USDT"


# --- Adapter metadata ---

def test_name(adapter):
    assert adapter.name == "coinbase"

def test_network(adapter):
    assert adapter.network == "paper"


# --- fetch_ticker (mocked HTTP) ---

@pytest.mark.asyncio
async def test_fetch_ticker_success(adapter):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "price": "65000.00",
        "bid": "64990.00",
        "ask": "65010.00",
        "volume_24h": "12345.67",
    }
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=AsyncMock(get=AsyncMock(return_value=mock_response)))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_ctx
        ticker = await adapter.fetch_ticker("BTCUSDT")
    assert ticker.symbol == "BTCUSDT"
    assert ticker.price == Decimal("65000.00")


@pytest.mark.asyncio
async def test_fetch_ticker_404_raises_symbol_not_found(adapter):
    from backend.adapters.exchanges.base import AdapterSymbolNotFoundError
    mock_response = MagicMock()
    mock_response.status_code = 404
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=AsyncMock(get=AsyncMock(return_value=mock_response)))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_ctx
        with pytest.raises(AdapterSymbolNotFoundError):
            await adapter.fetch_ticker("FAKEUSDT")


@pytest.mark.asyncio
async def test_fetch_ticker_429_raises_rate_limit(adapter):
    from backend.adapters.exchanges.base import AdapterRateLimitError
    mock_response = MagicMock()
    mock_response.status_code = 429
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=AsyncMock(get=AsyncMock(return_value=mock_response)))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_ctx
        with pytest.raises(AdapterRateLimitError):
            await adapter.fetch_ticker("BTCUSDT")


# --- Live execution methods must be disabled ---

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
    """Critical: Coinbase cannot place real orders."""
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


# --- exchange_status (mocked) ---

@pytest.mark.asyncio
async def test_exchange_status_connected(adapter):
    mock_response = MagicMock()
    mock_response.status_code = 200
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=AsyncMock(get=AsyncMock(return_value=mock_response)))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_ctx
        status = await adapter.exchange_status()
    assert status.connected is True
    assert status.exchange_name == "coinbase"

@pytest.mark.asyncio
async def test_exchange_status_disconnected(adapter):
    import httpx as _httpx
    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(side_effect=_httpx.ConnectError("connection refused"))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_ctx
        status = await adapter.exchange_status()
    assert status.connected is False
    assert status.error is not None
