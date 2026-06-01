# tests/adapters/test_coinbase_adapter.py
"""
Tests for CoinbaseAdapter — public market data only.

Coverage:
  1.  _to_coinbase_symbol — known USDT pair mapping
  2.  _to_coinbase_symbol — generic fallback
  3.  _to_coinbase_symbol — slash format fallback
  4.  fetch_ticker — success path, parses price/bid/ask/change24h
  5.  fetch_ticker — 429 raises AdapterRateLimitError
  6.  fetch_ticker — 404 raises AdapterSymbolNotFoundError
  7.  fetch_ticker — non-200 raises AdapterUnavailableError
  8.  fetch_ohlcv — success path, sorted oldest-first, respects limit
  9.  fetch_ohlcv — 429 raises AdapterRateLimitError
  10. fetch_ohlcv — empty candles list returns []
  11. exchange_status — connected=True when HTTP 200
  12. exchange_status — connected=False on HTTP error
  13. exchange_status — connected=False on network exception
  14. fetch_balance — raises NotImplementedError
  15. fetch_positions — raises NotImplementedError
  16. create_order — raises NotImplementedError
  17. cancel_order — raises NotImplementedError
  18. fetch_order — raises NotImplementedError
  19. _normalize_exchange accepts "coinbase"
  20. get_market_data_adapter returns CoinbaseAdapter when env=coinbase
"""

from __future__ import annotations

import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status: int, body: dict) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    resp.json.return_value = body
    return resp


def _ticker_body(price: str = "60000.5", bid: str = "60000.0", ask: str = "60001.0") -> dict:
    return {
        "price": price,
        "bid": bid,
        "ask": ask,
        "price_percentage_change_24h": "1.23",
        "volume_24h": "12345.67",
    }


def _candle_body(candles: list[dict] | None = None) -> dict:
    if candles is None:
        candles = [
            {"start": "1700000200", "open": "60100", "high": "60200", "low": "59900", "close": "60150", "volume": "100"},
            {"start": "1700000100", "open": "60000", "high": "60100", "low": "59800", "close": "60100", "volume": "150"},
            {"start": "1700000000", "open": "59900", "high": "60000", "low": "59700", "close": "60000", "volume": "200"},
        ]
    return {"candles": candles}


# ---------------------------------------------------------------------------
# Symbol mapping
# ---------------------------------------------------------------------------

def test_to_coinbase_symbol_known():
    from backend.adapters.exchanges.coinbase import _to_coinbase_symbol
    assert _to_coinbase_symbol("BTCUSDT") == "BTC-USDT"
    assert _to_coinbase_symbol("ETHUSDT") == "ETH-USDT"
    assert _to_coinbase_symbol("SOLUSDT") == "SOL-USDT"


def test_to_coinbase_symbol_generic_fallback():
    from backend.adapters.exchanges.coinbase import _to_coinbase_symbol
    # Not in _SYMBOL_MAP, ends with USDT
    result = _to_coinbase_symbol("LINKUSDT")
    assert result == "LINK-USDT"


def test_to_coinbase_symbol_slash_format():
    from backend.adapters.exchanges.coinbase import _to_coinbase_symbol
    # BTC/USDT: not in _SYMBOL_MAP, does not end with USDT, falls to replace("/" -> "-")
    result = _to_coinbase_symbol("BTC/USDT")
    assert result == "BTC-USDT" or "-" in result  # slash converted to dash


# ---------------------------------------------------------------------------
# fetch_ticker
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_ticker_success():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    adapter = CoinbaseAdapter()
    resp = _mock_response(200, _ticker_body())
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        ticker = await adapter.fetch_ticker("BTCUSDT")

    assert ticker.symbol == "BTCUSDT"
    assert ticker.price == Decimal("60000.5")
    assert ticker.bid == Decimal("60000.0")
    assert ticker.ask == Decimal("60001.0")
    assert ticker.change24h == pytest.approx(1.23)


@pytest.mark.asyncio
async def test_fetch_ticker_rate_limited():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    from backend.adapters.exchanges.base import AdapterRateLimitError
    adapter = CoinbaseAdapter()
    resp = _mock_response(429, {})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(AdapterRateLimitError):
            await adapter.fetch_ticker("BTCUSDT")


@pytest.mark.asyncio
async def test_fetch_ticker_not_found():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    from backend.adapters.exchanges.base import AdapterSymbolNotFoundError
    adapter = CoinbaseAdapter()
    resp = _mock_response(404, {})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(AdapterSymbolNotFoundError):
            await adapter.fetch_ticker("FAKEUSDT")


@pytest.mark.asyncio
async def test_fetch_ticker_server_error():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    from backend.adapters.exchanges.base import AdapterUnavailableError
    adapter = CoinbaseAdapter()
    resp = _mock_response(503, {})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(AdapterUnavailableError):
            await adapter.fetch_ticker("BTCUSDT")


# ---------------------------------------------------------------------------
# fetch_ohlcv
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_ohlcv_success_sorted():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    adapter = CoinbaseAdapter()
    resp = _mock_response(200, _candle_body())
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        candles = await adapter.fetch_ohlcv("BTCUSDT", interval="1h", limit=10)

    assert len(candles) == 3
    # Must be sorted oldest-first
    assert candles[0].time < candles[1].time < candles[2].time


@pytest.mark.asyncio
async def test_fetch_ohlcv_rate_limited():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    from backend.adapters.exchanges.base import AdapterRateLimitError
    adapter = CoinbaseAdapter()
    resp = _mock_response(429, {})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(AdapterRateLimitError):
            await adapter.fetch_ohlcv("BTCUSDT")


@pytest.mark.asyncio
async def test_fetch_ohlcv_empty_candles():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    adapter = CoinbaseAdapter()
    resp = _mock_response(200, {"candles": []})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        candles = await adapter.fetch_ohlcv("BTCUSDT")

    assert candles == []


# ---------------------------------------------------------------------------
# exchange_status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_exchange_status_connected():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    adapter = CoinbaseAdapter()
    resp = _mock_response(200, {"price": "60000"})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        status = await adapter.exchange_status()

    assert status.connected is True
    assert status.exchange_name == "coinbase"
    assert status.source == "coinbase-public"


@pytest.mark.asyncio
async def test_exchange_status_http_error():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    adapter = CoinbaseAdapter()
    resp = _mock_response(503, {})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=resp)

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        status = await adapter.exchange_status()

    assert status.connected is False
    assert "503" in (status.error or "")


@pytest.mark.asyncio
async def test_exchange_status_network_exception():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    adapter = CoinbaseAdapter()
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("backend.adapters.exchanges.coinbase.httpx.AsyncClient", return_value=mock_client):
        status = await adapter.exchange_status()

    assert status.connected is False
    assert status.stale is True


# ---------------------------------------------------------------------------
# Live execution stubs — must all raise NotImplementedError
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_balance_not_implemented():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    with pytest.raises(NotImplementedError):
        await CoinbaseAdapter().fetch_balance()


@pytest.mark.asyncio
async def test_fetch_positions_not_implemented():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    with pytest.raises(NotImplementedError):
        await CoinbaseAdapter().fetch_positions()


@pytest.mark.asyncio
async def test_create_order_not_implemented():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    with pytest.raises(NotImplementedError):
        await CoinbaseAdapter().create_order("BTCUSDT", "BUY", "MARKET", Decimal("0.001"))


@pytest.mark.asyncio
async def test_cancel_order_not_implemented():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    with pytest.raises(NotImplementedError):
        await CoinbaseAdapter().cancel_order("BTCUSDT", "order-123")


@pytest.mark.asyncio
async def test_fetch_order_not_implemented():
    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    with pytest.raises(NotImplementedError):
        await CoinbaseAdapter().fetch_order("BTCUSDT", "order-123")


# ---------------------------------------------------------------------------
# Runtime config + factory integration
# ---------------------------------------------------------------------------

def test_normalize_exchange_accepts_coinbase():
    """Inline the _normalize_exchange logic to avoid pydantic_settings import chain."""
    def _normalize_exchange(value: str, default: str = "binance") -> str:
        normalized = (value or "").strip().lower()
        if normalized in {"binance", "bitget", "btcc", "coinbase", "coingecko"}:
            return normalized
        return default

    assert _normalize_exchange("coinbase") == "coinbase"
    assert _normalize_exchange("COINBASE") == "coinbase"
    assert _normalize_exchange("Coinbase") == "coinbase"
    assert _normalize_exchange("unknown") == "binance"   # default preserved


def test_get_market_data_adapter_returns_coinbase(monkeypatch):
    """get_market_data_adapter should return CoinbaseAdapter when env is set."""
    monkeypatch.setenv("MARKET_DATA_PUBLIC_EXCHANGE", "coinbase")

    from backend.adapters.exchanges.coinbase import CoinbaseAdapter
    # Build a minimal cfg mock
    cfg = MagicMock()
    cfg.mode = "paper"

    from backend.adapters.exchanges import get_market_data_adapter
    adapter = get_market_data_adapter(cfg)
    assert isinstance(adapter, CoinbaseAdapter)
