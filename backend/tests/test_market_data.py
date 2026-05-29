"""Tests for public market data services (Binance, Bitget, BTCC).

Covers REST ticker parsing, snapshot caching, status tracking, stale-data
detection, and reconnection/fallback behaviour — all with mocked HTTP.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.logic.market_data import (
    BasePublicMarketDataService,
    BinancePublicMarketDataService,
    BitgetPublicMarketDataService,
    BTCCPublicMarketDataService,
    build_public_market_data_service,
    _safe_float,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeResponse:
    """Minimal httpx.Response stand-in."""

    def __init__(self, data: Any, status: int = 200) -> None:
        self._data = data
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")

    def json(self) -> Any:
        return self._data


class _FakeHttpClient:
    """Replaces httpx.AsyncClient in the service."""

    def __init__(self, responses: Dict[str, Any]) -> None:
        self._responses = responses
        self.calls: List[str] = []

    async def get(self, url: str, *, params: Optional[Dict[str, Any]] = None) -> _FakeResponse:
        self.calls.append(url)
        for key, data in self._responses.items():
            if key in url:
                return _FakeResponse(data)
        return _FakeResponse({}, status=404)

    async def aclose(self) -> None:
        pass


BINANCE_TICKER_RESPONSE = {
    "s": "BTCUSDT",
    "c": "43500.00",
    "P": "2.5",
    "q": "500000000.0",
    "v": "12000.0",
}

BITGET_TICKER_RESPONSE = {
    "code": "00000",
    "data": [
        {
            "symbol": "BTCUSDT",
            "lastPr": "43200.00",
            "open24h": "42000.00",
            "change24h": "2.86",
            "usdtVol": "320000000.0",
            "baseVol": "7500.0",
        }
    ],
}

BTCC_TICKER_RESPONSE = {
    "data": [
        {
            "symbol": "BTCUSDT",
            "last": "43100.00",
            "priceChangePercent": "1.9",
            "turnover": "200000000.0",
            "volume": "4600.0",
        }
    ],
}


# ---------------------------------------------------------------------------
# build_public_market_data_service factory
# ---------------------------------------------------------------------------

class TestBuildFactory:
    def test_binance(self) -> None:
        svc = build_public_market_data_service("binance", symbols=["BTCUSDT"])
        assert isinstance(svc, BinancePublicMarketDataService)

    def test_bitget(self) -> None:
        svc = build_public_market_data_service("bitget", symbols=["BTCUSDT"])
        assert isinstance(svc, BitgetPublicMarketDataService)

    def test_btcc(self) -> None:
        svc = build_public_market_data_service("btcc", symbols=["BTCUSDT"])
        assert isinstance(svc, BTCCPublicMarketDataService)

    def test_unknown_exchange_falls_back(self) -> None:
        svc = build_public_market_data_service("unknown_exchange", symbols=["BTCUSDT"])
        assert isinstance(svc, BasePublicMarketDataService)


# ---------------------------------------------------------------------------
# Binance service
# ---------------------------------------------------------------------------

class TestBinanceService:
    @pytest.fixture
    def service(self) -> BinancePublicMarketDataService:
        return BinancePublicMarketDataService(
            symbols=["BTCUSDT", "ETHUSDT"],
            poll_interval_seconds=1.0,
            stale_after_seconds=5.0,
        )

    def test_properties(self, service: BinancePublicMarketDataService) -> None:
        assert service.supports_websocket is True
        assert service.websocket_source == "binance-public"
        assert service.rest_source == "binance-rest"

    @pytest.mark.asyncio
    async def test_fetch_rest_ticker(self, service: BinancePublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"ticker/24hr": BINANCE_TICKER_RESPONSE})
        service._http = fake_http
        result = await service._fetch_rest_ticker("BTCUSDT")
        assert result["symbol"] == "BTCUSDT"
        assert result["price"] == 43500.0
        assert result["change24h"] == 2.5

    @pytest.mark.asyncio
    async def test_poll_updates_snapshot(self, service: BinancePublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"ticker/24hr": BINANCE_TICKER_RESPONSE})
        service._http = fake_http
        await service._poll_once()
        snap = service.get_snapshot("BTCUSDT")
        assert snap is not None
        assert snap["price"] == 43500.0

    def test_get_snapshot_missing_returns_none(self, service: BinancePublicMarketDataService) -> None:
        assert service.get_snapshot("UNKNOWN") is None

    def test_initial_status_is_stale(self, service: BinancePublicMarketDataService) -> None:
        status = service.get_status()
        assert status["stale"] is True
        assert status["connected"] is False

    @pytest.mark.asyncio
    async def test_status_updates_after_poll(self, service: BinancePublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"ticker/24hr": BINANCE_TICKER_RESPONSE})
        service._http = fake_http
        await service._poll_once()
        status = service.get_status()
        assert status["connected"] is True
        assert status["stale"] is False
        assert status["source"] in ("binance-rest", "binance-public")

    @pytest.mark.asyncio
    async def test_stale_detection_after_timeout(self, service: BinancePublicMarketDataService) -> None:
        svc = BinancePublicMarketDataService(
            symbols=["BTCUSDT"],
            stale_after_seconds=0.01,
        )
        fake_http = _FakeHttpClient({"ticker/24hr": BINANCE_TICKER_RESPONSE})
        svc._http = fake_http
        await svc._poll_once()
        await asyncio.sleep(0.05)
        status = svc.get_status()
        assert status["stale"] is True

    @pytest.mark.asyncio
    async def test_on_market_update_callback(self) -> None:
        updates: List[Dict[str, Any]] = []

        async def handler(snapshot: Dict[str, Any]) -> None:
            updates.append(snapshot)

        svc = BinancePublicMarketDataService(
            symbols=["BTCUSDT"],
            on_market_update=handler,
        )
        fake_http = _FakeHttpClient({"ticker/24hr": BINANCE_TICKER_RESPONSE})
        svc._http = fake_http
        await svc._poll_once()
        assert len(updates) == 1
        assert updates[0]["symbol"] == "BTCUSDT"

    @pytest.mark.asyncio
    async def test_on_status_change_callback(self) -> None:
        statuses: List[Dict[str, Any]] = []

        async def handler(status: Dict[str, Any]) -> None:
            statuses.append(status)

        svc = BinancePublicMarketDataService(
            symbols=["BTCUSDT"],
            on_status_change=handler,
        )
        fake_http = _FakeHttpClient({"ticker/24hr": BINANCE_TICKER_RESPONSE})
        svc._http = fake_http
        await svc._poll_once()
        assert len(statuses) > 0

    @pytest.mark.asyncio
    async def test_rest_fallback_on_http_error(self, service: BinancePublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({})  # no matching response → 404
        service._http = fake_http
        with pytest.raises(Exception):
            await service._poll_once()


# ---------------------------------------------------------------------------
# Bitget service
# ---------------------------------------------------------------------------

class TestBitgetService:
    @pytest.fixture
    def service(self) -> BitgetPublicMarketDataService:
        return BitgetPublicMarketDataService(symbols=["BTCUSDT"])

    def test_properties(self, service: BitgetPublicMarketDataService) -> None:
        assert service.supports_websocket is True
        assert service.rest_source == "bitget-rest"

    @pytest.mark.asyncio
    async def test_fetch_rest_ticker(self, service: BitgetPublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"market/tickers": BITGET_TICKER_RESPONSE})
        service._http = fake_http
        result = await service._fetch_rest_ticker("BTCUSDT")
        assert result["symbol"] == "BTCUSDT"
        assert result["price"] == 43200.0

    @pytest.mark.asyncio
    async def test_change_computed_from_open24h(self) -> None:
        no_change_response = {
            "code": "00000",
            "data": [
                {
                    "symbol": "BTCUSDT",
                    "lastPr": "42000.00",
                    "open24h": "40000.00",
                    "change24h": "0",
                    "usdtVol": "100000.0",
                    "baseVol": "2.0",
                }
            ],
        }
        svc = BitgetPublicMarketDataService(symbols=["BTCUSDT"])
        fake_http = _FakeHttpClient({"market/tickers": no_change_response})
        svc._http = fake_http
        result = await svc._fetch_rest_ticker("BTCUSDT")
        assert result["change24h"] == pytest.approx(5.0, rel=0.01)

    @pytest.mark.asyncio
    async def test_poll_populates_snapshot(self, service: BitgetPublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"market/tickers": BITGET_TICKER_RESPONSE})
        service._http = fake_http
        await service._poll_once()
        snap = service.get_snapshot("BTCUSDT")
        assert snap is not None
        assert snap["exchange"] == "bitget"


# ---------------------------------------------------------------------------
# BTCC service
# ---------------------------------------------------------------------------

class TestBTCCService:
    @pytest.fixture
    def service(self) -> BTCCPublicMarketDataService:
        return BTCCPublicMarketDataService(symbols=["BTCUSDT"])

    def test_no_websocket(self, service: BTCCPublicMarketDataService) -> None:
        assert service.supports_websocket is False

    @pytest.mark.asyncio
    async def test_fetch_rest_ticker(self, service: BTCCPublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"market/ticker": BTCC_TICKER_RESPONSE})
        service._http = fake_http
        result = await service._fetch_rest_ticker("BTCUSDT")
        assert result["symbol"] == "BTCUSDT"
        assert result["price"] == 43100.0
        assert result["change24h"] == 1.9

    @pytest.mark.asyncio
    async def test_poll_populates_snapshot(self, service: BTCCPublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"market/ticker": BTCC_TICKER_RESPONSE})
        service._http = fake_http
        await service._poll_once()
        snap = service.get_snapshot("BTCUSDT")
        assert snap is not None
        assert snap["exchange"] == "btcc"

    @pytest.mark.asyncio
    async def test_empty_response_handled(self, service: BTCCPublicMarketDataService) -> None:
        fake_http = _FakeHttpClient({"market/ticker": {"data": []}})
        service._http = fake_http
        await service._poll_once()
        snap = service.get_snapshot("BTCUSDT")
        assert snap is not None
        assert snap["price"] == 0.0


# ---------------------------------------------------------------------------
# _safe_float utility
# ---------------------------------------------------------------------------

class TestSafeFloat:
    def test_valid_float(self) -> None:
        assert _safe_float("43500.0") == 43500.0

    def test_none(self) -> None:
        assert _safe_float(None) == 0.0

    def test_invalid_string(self) -> None:
        assert _safe_float("not_a_number") == 0.0

    def test_int(self) -> None:
        assert _safe_float(42) == 42.0


# ---------------------------------------------------------------------------
# Start/stop lifecycle
# ---------------------------------------------------------------------------

class TestLifecycle:
    @pytest.mark.asyncio
    async def test_start_and_stop(self) -> None:
        svc = BTCCPublicMarketDataService(symbols=["BTCUSDT"])
        fake_http = _FakeHttpClient({"market/ticker": BTCC_TICKER_RESPONSE})
        svc._http = fake_http
        await svc.start()
        assert svc._task is not None
        await svc.stop()
        assert svc._task is None

    @pytest.mark.asyncio
    async def test_double_start_is_idempotent(self) -> None:
        svc = BTCCPublicMarketDataService(symbols=["BTCUSDT"])
        fake_http = _FakeHttpClient({"market/ticker": BTCC_TICKER_RESPONSE})
        svc._http = fake_http
        await svc.start()
        task = svc._task
        await svc.start()
        assert svc._task is task
        await svc.stop()
