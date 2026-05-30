# tests/adapters/test_binance_us_ohlcv.py
"""
Tests for the BinanceUsOhlcvAdapter — candle parsing, error handling,
geo-block fallback, and exchange_status.
"""
from __future__ import annotations

import time
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.adapters.exchanges.binance_us_ohlcv import (
    BinanceUsOhlcvAdapter,
    _parse_klines,
)
from backend.adapters.exchanges.base import AdapterUnavailableError, OhlcvCandle


def _kline_row(close=50000.0, ts_ms=None):
    ts = ts_ms or int(time.time() * 1000)
    return [ts, "49500.0", "51000.0", "49000.0", str(close), "123.45",
            ts + 3_600_000, "6000000.0", 500, "60.0", "3000000.0", "0"]


def _mock_resp(status=200, body=None):
    resp = MagicMock()
    resp.status_code = status
    resp.is_success = (200 <= status < 300)
    resp.json = MagicMock(return_value=body if body is not None else [])
    return resp


# ---------------------------------------------------------------------------
# _parse_klines unit tests
# ---------------------------------------------------------------------------

class TestParseKlines:
    def test_parses_close_price(self):
        candles = _parse_klines([_kline_row(close=74000.0)])
        assert len(candles) == 1
        assert float(candles[0].close) == pytest.approx(74000.0)

    def test_parses_ohlcv_fields(self):
        row = _kline_row(close=50000.0)
        candles = _parse_klines([row])
        c = candles[0]
        assert float(c.open)   == pytest.approx(49500.0)
        assert float(c.high)   == pytest.approx(51000.0)
        assert float(c.low)    == pytest.approx(49000.0)
        assert float(c.close)  == pytest.approx(50000.0)
        assert float(c.volume) == pytest.approx(123.45)

    def test_timestamp_converted_from_ms_to_seconds(self):
        ts_ms = 1_780_000_000_000
        candles = _parse_klines([_kline_row(ts_ms=ts_ms)])
        assert candles[0].time == int(ts_ms / 1000.0)

    def test_parses_multiple_rows(self):
        rows = [_kline_row(close=float(i * 1000)) for i in range(1, 6)]
        candles = _parse_klines(rows)
        assert len(candles) == 5
        assert float(candles[-1].close) == pytest.approx(5000.0)

    def test_empty_input_returns_empty_list(self):
        assert _parse_klines([]) == []


# ---------------------------------------------------------------------------
# BinanceUsOhlcvAdapter.fetch_ohlcv
# ---------------------------------------------------------------------------

class TestFetchOhlcv:
    @pytest.fixture
    def adapter(self):
        return BinanceUsOhlcvAdapter(paper=True)

    @pytest.mark.asyncio
    async def test_returns_candles_on_200(self, adapter):
        rows = [_kline_row(close=float(74000 + i)) for i in range(220)]
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(return_value=_mock_resp(200, rows))),
        ):
            candles = await adapter.fetch_ohlcv("BTCUSDT", "1h", 220)
        assert len(candles) == 220
        assert float(candles[0].close) == pytest.approx(74000.0)

    @pytest.mark.asyncio
    async def test_returns_empty_on_451_geoblock(self, adapter):
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(return_value=_mock_resp(451))),
        ):
            candles = await adapter.fetch_ohlcv("BTCUSDT", "1h", 220)
        assert candles == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_429_rate_limit(self, adapter):
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(return_value=_mock_resp(429))),
        ):
            candles = await adapter.fetch_ohlcv("BTCUSDT", "1h", 220)
        assert candles == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_500_server_error(self, adapter):
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(return_value=_mock_resp(500))),
        ):
            candles = await adapter.fetch_ohlcv("BTCUSDT", "1h", 220)
        assert candles == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_network_exception(self, adapter):
        import httpx
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(side_effect=httpx.TimeoutException("timeout"))),
        ):
            candles = await adapter.fetch_ohlcv("BTCUSDT", "1h", 220)
        assert candles == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_response_is_error_dict(self, adapter):
        error_body = {"code": -1121, "msg": "Invalid symbol"}
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(return_value=_mock_resp(200, error_body))),
        ):
            candles = await adapter.fetch_ohlcv("INVALIDUSDT", "1h", 10)
        assert candles == []

    @pytest.mark.asyncio
    async def test_limit_capped_at_1000(self, adapter):
        rows = [_kline_row() for _ in range(10)]
        mock_get = AsyncMock(return_value=_mock_resp(200, rows))
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=mock_get),
        ):
            await adapter.fetch_ohlcv("BTCUSDT", "1h", 5000)
        params = mock_get.call_args.kwargs.get("params") or mock_get.call_args[1].get("params")
        assert params["limit"] == 1000

    @pytest.mark.asyncio
    async def test_symbol_uppercased(self, adapter):
        rows = [_kline_row() for _ in range(5)]
        mock_get = AsyncMock(return_value=_mock_resp(200, rows))
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=mock_get),
        ):
            await adapter.fetch_ohlcv("btcusdt", "1h", 5)
        params = mock_get.call_args.kwargs.get("params") or mock_get.call_args[1].get("params")
        assert params["symbol"] == "BTCUSDT"


# ---------------------------------------------------------------------------
# exchange_status
# ---------------------------------------------------------------------------

class TestExchangeStatus:
    @pytest.fixture
    def adapter(self):
        return BinanceUsOhlcvAdapter(paper=True)

    @pytest.mark.asyncio
    async def test_connected_when_time_endpoint_200(self, adapter):
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(return_value=_mock_resp(200, {"serverTime": 1234}))),
        ):
            status = await adapter.exchange_status()
        assert status.connected is True
        assert status.market_data_available is True

    @pytest.mark.asyncio
    async def test_offline_on_network_error(self, adapter):
        import httpx
        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv._get_client",
            return_value=MagicMock(get=AsyncMock(side_effect=httpx.ConnectError("refused"))),
        ):
            status = await adapter.exchange_status()
        assert status.connected is False
        assert "refused" in (status.error or "")


# ---------------------------------------------------------------------------
# Unsupported methods raise AdapterUnavailableError
# ---------------------------------------------------------------------------

class TestUnsupportedMethods:
    @pytest.fixture
    def adapter(self):
        return BinanceUsOhlcvAdapter(paper=True)

    @pytest.mark.asyncio
    async def test_fetch_ticker_raises(self, adapter):
        with pytest.raises(AdapterUnavailableError):
            await adapter.fetch_ticker("BTCUSDT")

    @pytest.mark.asyncio
    async def test_fetch_balance_raises(self, adapter):
        with pytest.raises(AdapterUnavailableError):
            await adapter.fetch_balance()

    @pytest.mark.asyncio
    async def test_create_order_raises(self, adapter):
        with pytest.raises(AdapterUnavailableError):
            await adapter.create_order(
                symbol="BTCUSDT", side="BUY", order_type="MARKET",
                quantity=Decimal("0.01"),
            )


# ---------------------------------------------------------------------------
# Signal service _fetch_candles priority chain
# ---------------------------------------------------------------------------

class TestFetchCandlesChain:
    @pytest.mark.asyncio
    async def test_uses_binance_us_when_available(self):
        import backend.services.signal_service.service as svc
        svc._ohlcv_adapter = None

        rows = [_kline_row(close=float(74000 + i)) for i in range(220)]
        mock_adapter = MagicMock()
        mock_adapter.fetch_ohlcv = AsyncMock(return_value=_parse_klines(rows))

        with patch(
            "backend.adapters.exchanges.binance_us_ohlcv.BinanceUsOhlcvAdapter",
            return_value=mock_adapter,
        ):
            svc._ohlcv_adapter = None
            candles = await svc._fetch_candles("BTCUSDT", limit=220)

        assert len(candles) == 220
        assert float(candles[0].close) == pytest.approx(74000.0)

    @pytest.mark.asyncio
    async def test_falls_back_to_generic_chain_when_binance_us_returns_empty(self):
        import backend.services.signal_service.service as svc
        from backend.adapters.exchanges.base import OhlcvCandle

        svc._ohlcv_adapter = None

        fallback_candle = OhlcvCandle(
            time=int(time.time()), open=Decimal("1.0"), high=Decimal("1.1"),
            low=Decimal("0.9"), close=Decimal("1.0"), volume=Decimal("100.0"),
        )

        mock_binance = MagicMock()
        mock_binance.fetch_ohlcv = AsyncMock(return_value=[])

        mock_fallback = MagicMock()
        mock_fallback.fetch_ohlcv = AsyncMock(return_value=[fallback_candle] * 50)

        with (
            patch("backend.adapters.exchanges.binance_us_ohlcv.BinanceUsOhlcvAdapter",
                  return_value=mock_binance),
            patch("backend.services.market_data.service._get_adapters",
                  new_callable=AsyncMock, return_value=[mock_fallback]),
        ):
            svc._ohlcv_adapter = None
            candles = await svc._fetch_candles("BTCUSDT", limit=50)

        assert len(candles) == 50

    @pytest.mark.asyncio
    async def test_returns_empty_when_all_sources_fail(self):
        import backend.services.signal_service.service as svc
        svc._ohlcv_adapter = None

        with (
            patch("backend.adapters.exchanges.binance_us_ohlcv.BinanceUsOhlcvAdapter",
                  side_effect=ImportError("not available")),
            patch("backend.services.market_data.service._get_adapters",
                  new_callable=AsyncMock, return_value=[]),
        ):
            svc._ohlcv_adapter = None
            candles = await svc._fetch_candles("BTCUSDT", limit=220)

        assert candles == []
