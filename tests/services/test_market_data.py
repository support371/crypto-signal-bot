# tests/services/test_market_data.py
"""
PHASE 6 — Market data service tests.

Tests:
  1. Ordered stream behavior — primary adapter used first, fallover on failure
  2. Stale data handling — stale flag set, MarketDataStale raised appropriately
  3. Unavailable exchange handling — MarketDataUnavailable raised, no synthetic data
  4. Explicit failure behavior — 503 returned, never fabricated price
  5. SYNTHETIC mode removal — "SYNTHETIC" never appears in any response
  6. WebSocket publication — Redis pub/sub called on successful fetch
  7. Route tests — HTTP response shapes and status codes

Run: pytest tests/services/test_market_data.py -v
"""

from __future__ import annotations

import json
import time
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch, call
from typing import Optional

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from backend.adapters.exchanges.base import (
    AdapterUnavailableError,
    AdapterRateLimitError,
    ExchangeStatus,
    OhlcvCandle,
    Ticker,
)
from backend.services.market_data.service import (
    MarketDataUnavailable,
    MarketDataStale,
    PriceSnapshot,
    PRICE_STALE_THRESHOLD_SECONDS,
    _last_known,
    get_price,
    get_ohlcv,
    get_exchange_status,
)
from backend.routes.price import router as price_router


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(price_router)
    return a


@pytest.fixture
async def client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_ticker(
    symbol: str = "BTCUSDT",
    price: float = 50_000.0,
    change24h: float = 1.5,
) -> Ticker:
    p = Decimal(str(price))
    return Ticker(
        symbol=symbol,
        price=p,
        bid=p - Decimal("1"),
        ask=p + Decimal("1"),
        spread=Decimal("2"),
        change24h=change24h,
        volume24h=Decimal("999"),
        timestamp=int(time.time()),
    )


def _make_candles(n: int = 5) -> list[OhlcvCandle]:
    now = int(time.time())
    return [
        OhlcvCandle(
            time=now - (n - i) * 3600,
            open=Decimal("49000"),
            high=Decimal("51000"),
            low=Decimal("48500"),
            close=Decimal("50000"),
            volume=Decimal("100"),
        )
        for i in range(n)
    ]


def _mock_exchange_status(connected: bool = True, mode: str = "paper_live") -> ExchangeStatus:
    return ExchangeStatus(
        connected=connected,
        mode="paper",
        exchange_name="test_exchange",
        market_data_available=connected,
        market_data_mode=mode,
        connection_state="connected" if connected else "offline",
        fallback_active=False,
        stale=not connected,
        source="https://test.exchange",
        error=None if connected else "timeout",
    )


# ---------------------------------------------------------------------------
# 1. Ordered stream — primary adapter tried first, failover on failure
# ---------------------------------------------------------------------------

class TestOrderedAdapterFailover:
    @pytest.mark.asyncio
    async def test_primary_adapter_used_when_available(self):
        """Primary adapter is tried first and its result is returned."""
        ticker = _make_ticker()
        mock_adapter = MagicMock()
        mock_adapter.fetch_ticker = AsyncMock(return_value=ticker)
        mock_adapter.exchange_name = "primary"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[mock_adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            snap = await get_price("BTCUSDT")

        assert snap.source == "primary"
        assert float(snap.price) == pytest.approx(50_000.0)
        mock_adapter.fetch_ticker.assert_called_once_with("BTCUSDT")

    @pytest.mark.asyncio
    async def test_failover_to_secondary_when_primary_fails(self):
        """On primary failure, secondary adapter is tried."""
        primary = MagicMock()
        primary.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("offline"))
        primary.exchange_name = "primary"

        secondary = MagicMock()
        secondary.fetch_ticker = AsyncMock(return_value=_make_ticker())
        secondary.exchange_name = "secondary"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[primary, secondary])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            snap = await get_price("BTCUSDT")

        assert snap.source == "secondary"
        primary.fetch_ticker.assert_called_once()
        secondary.fetch_ticker.assert_called_once()

    @pytest.mark.asyncio
    async def test_all_adapters_fail_raises_unavailable(self):
        """When all adapters fail: MarketDataUnavailable is raised. No synthetic data."""
        def make_failing(name: str):
            m = MagicMock()
            m.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError(f"{name} down"))
            m.exchange_name = name
            return m

        adapters = [make_failing(n) for n in ["btcc", "binance", "bitget"]]

        # Clear in-process cache to prevent stale fallback
        _last_known.clear()

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=adapters)):
            with pytest.raises(MarketDataUnavailable) as exc_info:
                await get_price("BTCUSDT")

        assert "btcc" in exc_info.value.adapter_errors
        assert "binance" in exc_info.value.adapter_errors

    @pytest.mark.asyncio
    async def test_rate_limit_triggers_failover(self):
        """Rate limit on primary triggers failover to secondary (not synthetic data)."""
        primary = MagicMock()
        primary.fetch_ticker = AsyncMock(side_effect=AdapterRateLimitError("rate limited"))
        primary.exchange_name = "primary"

        secondary = MagicMock()
        secondary.fetch_ticker = AsyncMock(return_value=_make_ticker())
        secondary.exchange_name = "secondary"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[primary, secondary])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            snap = await get_price("BTCUSDT")

        assert snap.source == "secondary"
        assert snap.stale is False


# ---------------------------------------------------------------------------
# 2. Stale data handling
# ---------------------------------------------------------------------------

class TestStalenessDetection:
    @pytest.mark.asyncio
    async def test_stale_exception_raised_when_cache_exists_and_adapter_fails(self):
        """
        When adapter fails AND there is a cached ticker:
        MarketDataStale is raised (not MarketDataUnavailable).
        The stale ticker is attached.
        """
        ticker = _make_ticker()
        old_ts = int(time.time()) - (PRICE_STALE_THRESHOLD_SECONDS + 10)
        _last_known["BTCUSDT"] = (ticker, old_ts)

        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("down"))
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            with pytest.raises(MarketDataStale) as exc_info:
                await get_price("BTCUSDT")

        assert exc_info.value.stale_ticker is not None
        assert float(exc_info.value.stale_ticker.price) == pytest.approx(50_000.0)

        # Clean up
        del _last_known["BTCUSDT"]

    @pytest.mark.asyncio
    async def test_snapshot_has_stale_false_on_fresh_fetch(self):
        """Fresh fetch always returns stale=False."""
        ticker = _make_ticker()
        mock_adapter = MagicMock()
        mock_adapter.fetch_ticker = AsyncMock(return_value=ticker)
        mock_adapter.exchange_name = "test"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[mock_adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            snap = await get_price("BTCUSDT")

        assert snap.stale is False

    def test_stale_threshold_is_positive(self):
        """Stale threshold must be a positive integer."""
        assert PRICE_STALE_THRESHOLD_SECONDS > 0


# ---------------------------------------------------------------------------
# 3. Unavailable exchange handling
# ---------------------------------------------------------------------------

class TestUnavailableExchangeHandling:
    @pytest.mark.asyncio
    async def test_no_synthetic_data_on_complete_failure(self):
        """When all adapters fail and no cache: raise MarketDataUnavailable."""
        _last_known.clear()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("all down"))
        adapter.exchange_name = "only_adapter"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            with pytest.raises(MarketDataUnavailable) as exc_info:
                await get_price("SOLUSDT")

        err = exc_info.value
        # Confirm no synthetic price was generated
        assert err.stale_ticker is None if hasattr(err, "stale_ticker") else True
        assert "only_adapter" in err.adapter_errors

    @pytest.mark.asyncio
    async def test_unavailable_exception_carries_adapter_errors(self):
        """MarketDataUnavailable exposes per-adapter error messages."""
        _last_known.clear()
        a1 = MagicMock()
        a1.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("BTCC timeout"))
        a1.exchange_name = "btcc"
        a2 = MagicMock()
        a2.fetch_ticker = AsyncMock(side_effect=AdapterRateLimitError("Binance 429"))
        a2.exchange_name = "binance"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[a1, a2])):
            with pytest.raises(MarketDataUnavailable) as exc_info:
                await get_price("ETHUSDT")

        errors = exc_info.value.adapter_errors
        assert "btcc" in errors
        assert "binance" in errors
        assert "timeout" in errors["btcc"].lower() or "btcc" in errors["btcc"].lower()


# ---------------------------------------------------------------------------
# 4. Explicit failure behavior — routes return 503, never fabricated price
# ---------------------------------------------------------------------------

class TestExplicitFailureRoutes:
    @pytest.mark.asyncio
    async def test_price_route_returns_503_when_unavailable(self, client: AsyncClient):
        _last_known.clear()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("down"))
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            resp = await client.get("/price?symbol=BTCUSDT")

        assert resp.status_code == 503
        body = resp.json()
        # Must never contain a fabricated price
        assert "price" not in body or body.get("error")
        assert body.get("detail", {}).get("synthetic_fallback") is False

    @pytest.mark.asyncio
    async def test_ohlcv_route_returns_503_not_random_candles(self, client: AsyncClient):
        _last_known.clear()
        adapter = MagicMock()
        adapter.fetch_ohlcv = AsyncMock(side_effect=AdapterUnavailableError("down"))
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            resp = await client.get("/price/ohlcv?symbol=BTCUSDT")

        assert resp.status_code == 503
        body = resp.json()
        assert "candles" not in body
        assert body.get("detail", {}).get("synthetic_fallback") is False

    @pytest.mark.asyncio
    async def test_batch_route_returns_503_not_empty_list(self, client: AsyncClient):
        _last_known.clear()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("down"))
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            resp = await client.get("/prices/batch?symbols=BTCUSDT")

        # Must be 503, not 200 with empty/fake prices
        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_stale_price_returned_with_stale_header(self, client: AsyncClient):
        """Stale data returns 200 with X-Market-Data-Stale header — not silently fresh."""
        ticker = _make_ticker()
        old_ts = int(time.time()) - (PRICE_STALE_THRESHOLD_SECONDS + 5)
        _last_known["BTCUSDT"] = (ticker, old_ts)

        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("down"))
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            resp = await client.get("/price?symbol=BTCUSDT")

        # Stale: 200 with header
        assert resp.status_code == 200
        assert resp.headers.get("X-Market-Data-Stale") == "true"
        assert resp.json()["stale"] is True
        assert resp.json()["market_data_mode"] == "unavailable"

        # Clean up
        if "BTCUSDT" in _last_known:
            del _last_known["BTCUSDT"]


# ---------------------------------------------------------------------------
# 5. SYNTHETIC mode removed from all response surfaces
# ---------------------------------------------------------------------------

class TestSyntheticModeRemoval:
    @pytest.mark.asyncio
    async def test_exchange_status_never_returns_SYNTHETIC(self):
        """exchange_status() must never return market_data_mode='SYNTHETIC'."""
        # Simulate a backend that previously returned SYNTHETIC
        synthetic_status = ExchangeStatus(
            connected=False,
            mode="paper",
            exchange_name="test",
            market_data_available=False,
            market_data_mode="SYNTHETIC",  # the old value being replaced
            connection_state="offline",
            fallback_active=True,
            stale=True,
            source="synthetic",
            error="using synthetic fallback",
        )

        adapter = MagicMock()
        adapter.exchange_status = AsyncMock(return_value=synthetic_status)
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            status = await get_exchange_status()

        assert status.market_data_mode != "SYNTHETIC"
        assert status.market_data_mode == "unavailable"
        assert status.fallback_active is False

    @pytest.mark.asyncio
    async def test_price_response_never_has_SYNTHETIC_mode(self, client: AsyncClient):
        """No HTTP price response should contain market_data_mode='SYNTHETIC'."""
        ticker = _make_ticker()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(return_value=ticker)
        adapter.exchange_name = "test"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            resp = await client.get("/price?symbol=BTCUSDT")

        assert resp.status_code == 200
        data = resp.json()
        assert data["market_data_mode"] != "SYNTHETIC"
        assert data["market_data_mode"] in ("live", "paper_live", "unavailable")

    @pytest.mark.asyncio
    async def test_exchange_status_route_never_has_SYNTHETIC(self, client: AsyncClient):
        normal_status = _mock_exchange_status(connected=True, mode="paper_live")
        adapter = MagicMock()
        adapter.exchange_status = AsyncMock(return_value=normal_status)
        adapter.exchange_name = "test"

        with patch("backend.services.market_data.service._get_adapters",
                   new=AsyncMock(return_value=[adapter])):
            resp = await client.get("/exchange/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["market_data_mode"] != "SYNTHETIC"
        assert data["fallback_active"] is False


# ---------------------------------------------------------------------------
# 6. Redis publication on successful fetch
# ---------------------------------------------------------------------------

class TestRedisPublication:
    @pytest.mark.asyncio
    async def test_redis_publish_called_on_successful_fetch(self):
        """Successful price fetch publishes to Redis pub/sub channel."""
        ticker = _make_ticker()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(return_value=ticker)
        adapter.exchange_name = "test"

        mock_publish = AsyncMock()
        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", mock_publish),
        ):
            await get_price("BTCUSDT")

        mock_publish.assert_called_once()
        channel, message_str = mock_publish.call_args[0]
        assert channel == "market_updates"
        message = json.loads(message_str)
        assert message["type"] == "market_update"
        assert message["symbol"] == "BTCUSDT"
        assert message["price"] == pytest.approx(50_000.0)
        assert message["source"] == "test"

    @pytest.mark.asyncio
    async def test_redis_publish_not_called_on_failure(self):
        """On adapter failure: Redis publish must NOT be called (no fake event)."""
        _last_known.clear()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(side_effect=AdapterUnavailableError("down"))
        adapter.exchange_name = "test"

        mock_publish = AsyncMock()
        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.services.market_data.service._redis_publish", mock_publish),
        ):
            with pytest.raises((MarketDataUnavailable, MarketDataStale)):
                await get_price("BTCUSDT")

        mock_publish.assert_not_called()


# ---------------------------------------------------------------------------
# 7. Route response shape tests
# ---------------------------------------------------------------------------

class TestRouteShapes:
    @pytest.mark.asyncio
    async def test_price_route_shape(self, client: AsyncClient):
        ticker = _make_ticker()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(return_value=ticker)
        adapter.exchange_name = "test"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            resp = await client.get("/price?symbol=BTCUSDT")

        assert resp.status_code == 200
        data = resp.json()
        for field in ["symbol", "price", "bid", "ask", "change24h", "market_data_mode",
                      "source", "fetched_at", "stale", "timestamp"]:
            assert field in data, f"Missing field: {field}"

    @pytest.mark.asyncio
    async def test_ohlcv_route_shape(self, client: AsyncClient):
        candles = _make_candles(5)
        adapter = MagicMock()
        adapter.fetch_ohlcv = AsyncMock(return_value=candles)
        adapter.exchange_name = "test"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
        ):
            resp = await client.get("/price/ohlcv?symbol=BTCUSDT&interval=1h&limit=5")

        assert resp.status_code == 200
        data = resp.json()
        assert data["symbol"] == "BTCUSDT"
        assert len(data["candles"]) == 5
        for candle in data["candles"]:
            for field in ["time", "open", "high", "low", "close", "volume"]:
                assert field in candle, f"Candle missing field: {field}"

    @pytest.mark.asyncio
    async def test_batch_route_shape(self, client: AsyncClient):
        ticker = _make_ticker()
        adapter = MagicMock()
        adapter.fetch_ticker = AsyncMock(return_value=ticker)
        adapter.exchange_name = "test"

        with (
            patch("backend.services.market_data.service._get_adapters",
                  new=AsyncMock(return_value=[adapter])),
            patch("backend.services.market_data.service._redis_set", new=AsyncMock()),
            patch("backend.services.market_data.service._redis_publish", new=AsyncMock()),
        ):
            resp = await client.get("/prices/batch?symbols=BTCUSDT")

        assert resp.status_code == 200
        data = resp.json()
        assert "prices" in data
        assert len(data["prices"]) >= 1
        item = data["prices"][0]
        for field in ["id", "symbol", "name", "price", "change24h", "lastUpdated", "stale"]:
            assert field in item, f"Batch item missing field: {field}"

    @pytest.mark.asyncio
    async def test_invalid_interval_returns_400(self, client: AsyncClient):
        resp = await client.get("/price/ohlcv?symbol=BTCUSDT&interval=99X")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_invalid_batch_symbols_returns_400(self, client: AsyncClient):
        resp = await client.get("/prices/batch?symbols=NOTREAL,GARBAGE")
        assert resp.status_code == 400
