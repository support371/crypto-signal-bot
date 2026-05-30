"""
Public market-data ingestion for hybrid paper mode.

This service keeps paper execution intact while allowing the backend to consume
live public exchange ticker data for pricing, signal generation, and status.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Any, Dict, Optional

import httpx

from backend.logic.exchange_adapter import normalize_exchange_name

try:
    import websockets
except ImportError:  # pragma: no cover - optional in some local environments
    websockets = None

logger = logging.getLogger("backend.market_data")

MarketUpdateHandler = Callable[[Dict[str, Any]], Awaitable[None]]
StatusHandler = Callable[[Dict[str, Any]], Awaitable[None]]


def build_public_market_data_service(
    exchange: str,
    *,
    symbols: list[str],
    on_market_update: Optional[MarketUpdateHandler] = None,
    on_status_change: Optional[StatusHandler] = None,
):
    selected_exchange = normalize_exchange_name(exchange)
    service_cls = {
        "binance": BinancePublicMarketDataService,
        "bitget": BitgetPublicMarketDataService,
        "btcc": BTCCPublicMarketDataService,
    }[selected_exchange]
    return service_cls(
        symbols=symbols,
        on_market_update=on_market_update,
        on_status_change=on_status_change,
    )


class BasePublicMarketDataService(ABC):
    def __init__(
        self,
        *,
        exchange: str,
        symbols: list[str],
        on_market_update: Optional[MarketUpdateHandler] = None,
        on_status_change: Optional[StatusHandler] = None,
        poll_interval_seconds: float = 15.0,
        stale_after_seconds: float = 20.0,
        market_cap_quote_volume_multiplier: float = 20.0,
    ) -> None:
        self.exchange = normalize_exchange_name(exchange)
        self.symbols = [symbol.upper() for symbol in symbols]
        self._on_market_update = on_market_update
        self._on_status_change = on_status_change
        self._poll_interval_seconds = poll_interval_seconds
        self._stale_after_seconds = stale_after_seconds
        self._market_cap_quote_volume_multiplier = market_cap_quote_volume_multiplier
        self._task: Optional[asyncio.Task[None]] = None
        self._http: Optional[httpx.AsyncClient] = None
        self._snapshots: Dict[str, Dict[str, Any]] = {}
        self._status: Dict[str, Any] = {
            "exchange": self.exchange,
            "market_data_mode": "synthetic_paper",
            "connected": False,
            "connection_state": "disabled",
            "fallback_active": False,
            "last_update_ts": None,
            "last_error": None,
            "stale": True,
            "symbols": self.symbols,
            "source": "synthetic",
        }

    async def start(self) -> None:
        if self._task is not None:
            return
        self._http = httpx.AsyncClient(timeout=10.0)
        await self._seed_from_rest()
        self._task = asyncio.create_task(self._run(), name=f"{self.exchange}-public-market-data")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        if self._http is not None:
            await self._http.aclose()
            self._http = None

    def get_snapshot(self, symbol: str) -> Optional[Dict[str, Any]]:
        snapshot = self._snapshots.get(symbol.upper())
        return dict(snapshot) if snapshot else None

    def get_status(self) -> Dict[str, Any]:
        status = dict(self._status)
        last_update_ts = status.get("last_update_ts")
        status["stale"] = (
            last_update_ts is None
            or (time.time() - float(last_update_ts)) > self._stale_after_seconds
        )
        return status

    async def _run(self) -> None:
        while True:
            try:
                if self.supports_websocket:
                    await self._set_status(
                        market_data_mode="live_public_paper",
                        connected=False,
                        connection_state="connecting",
                        fallback_active=False,
                        source=self.websocket_source,
                    )
                    await self._run_websocket()
                else:
                    await self._set_status(
                        market_data_mode="live_public_paper",
                        connected=False,
                        connection_state="polling",
                        fallback_active=True,
                        source=self.rest_source,
                    )
                    await self._poll_once()
                    await asyncio.sleep(self._poll_interval_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("%s public feed failed: %s", self.exchange, exc)
                await self._set_status(
                    market_data_mode="live_public_paper",
                    connected=False,
                    connection_state="polling",
                    fallback_active=True,
                    last_error=str(exc),
                    source=self.rest_source,
                )
                try:
                    await self._poll_once()
                except Exception as poll_exc:
                    logger.warning("%s REST/polling fallback failed: %s", self.exchange, poll_exc)
                    await self._set_status(last_error=str(poll_exc))
                await asyncio.sleep(self._poll_interval_seconds)

    async def _seed_from_rest(self) -> None:
        try:
            await self._poll_once()
        except Exception as exc:
            logger.warning("Initial %s REST seed failed: %s", self.exchange, exc)
            await self._set_status(
                market_data_mode="live_public_paper",
                connected=False,
                connection_state="polling",
                fallback_active=True,
                last_error=str(exc),
                source=self.rest_source,
            )

    async def _poll_once(self) -> None:
        for symbol in self.symbols:
            payload = await self._fetch_rest_ticker(symbol)
            await self._handle_ticker_payload(payload, source=self.rest_source)

    async def _handle_ticker_payload(self, payload: Dict[str, Any], *, source: str) -> None:
        symbol = str(payload.get("symbol", "")).upper()
        if symbol not in self.symbols:
            return
        price = float(payload.get("price") or 0.0)
        change24h = float(payload.get("change24h") or 0.0)
        quote_volume = float(payload.get("volume24h") or 0.0)
        base_volume = float(payload.get("baseVolume24h") or 0.0)
        last_update_ts = time.time()

        snapshot = {
            "symbol": symbol,
            "price": price,
            "change24h": change24h,
            "volume24h": quote_volume,
            "baseVolume24h": base_volume,
            "marketCap": self._estimate_market_cap(price, quote_volume),
            "timestamp": last_update_ts,
            "source": source,
            "exchange": self.exchange,
        }
        self._snapshots[symbol] = snapshot

        await self._set_status(
            market_data_mode="live_public_paper",
            connected=True,
            connection_state="streaming" if source == self.websocket_source else "polling",
            fallback_active=source != self.websocket_source,
            last_update_ts=last_update_ts,
            last_error=None,
            source=source,
        )

        if self._on_market_update is not None:
            await self._on_market_update(dict(snapshot))

    async def _set_status(self, **updates: Any) -> None:
        changed = False
        for key, value in updates.items():
            if self._status.get(key) != value:
                self._status[key] = value
                changed = True
        if changed and self._on_status_change is not None:
            await self._on_status_change(self.get_status())

    def _estimate_market_cap(self, price: float, quote_volume: float) -> float:
        return max(quote_volume * self._market_cap_quote_volume_multiplier, price * 1_000_000.0)

    async def _http_get_json(self, url: str, *, params: Optional[Dict[str, Any]] = None) -> Any:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=10.0)
        response = await self._http.get(url, params=params)
        response.raise_for_status()
        return response.json()

    @property
    @abstractmethod
    def supports_websocket(self) -> bool:
        pass

    @property
    @abstractmethod
    def websocket_source(self) -> str:
        pass

    @property
    @abstractmethod
    def rest_source(self) -> str:
        pass

    @abstractmethod
    async def _fetch_rest_ticker(self, symbol: str) -> Dict[str, Any]:
        pass

    async def _run_websocket(self) -> None:
        raise RuntimeError(f"{self.exchange} websocket feed is not supported")


class BinancePublicMarketDataService(BasePublicMarketDataService):
    def __init__(
        self,
        *,
        symbols: list[str],
        on_market_update: Optional[MarketUpdateHandler] = None,
        on_status_change: Optional[StatusHandler] = None,
        poll_interval_seconds: float = 15.0,
        stale_after_seconds: float = 20.0,
        rest_base_url: str = "https://api.binance.com",
        ws_base_url: str = "wss://stream.binance.com:9443/stream",
    ) -> None:
        super().__init__(
            exchange="binance",
            symbols=symbols,
            on_market_update=on_market_update,
            on_status_change=on_status_change,
            poll_interval_seconds=poll_interval_seconds,
            stale_after_seconds=stale_after_seconds,
        )
        self._rest_base_url = rest_base_url.rstrip("/")
        self._ws_base_url = ws_base_url.rstrip("/")

    @property
    def supports_websocket(self) -> bool:
        return True

    @property
    def websocket_source(self) -> str:
        return "binance-public"

    @property
    def rest_source(self) -> str:
        return "binance-rest"

    async def _fetch_rest_ticker(self, symbol: str) -> Dict[str, Any]:
        payload = await self._http_get_json(
            f"{self._rest_base_url}/api/v3/ticker/24hr",
            params={"symbol": symbol},
        )
        return {
            "symbol": str(payload.get("s", symbol)).upper(),
            "price": float(payload.get("c") or payload.get("lastPrice") or 0.0),
            "change24h": float(payload.get("P") or payload.get("priceChangePercent") or 0.0),
            "volume24h": float(payload.get("q") or payload.get("quoteVolume") or 0.0),
            "baseVolume24h": float(payload.get("v") or payload.get("volume") or 0.0),
        }

    async def _run_websocket(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets is not installed")
        streams = "/".join(f"{symbol.lower()}@ticker" for symbol in self.symbols)
        url = f"{self._ws_base_url}?streams={streams}"
        async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
            await self._set_status(
                market_data_mode="live_public_paper",
                connected=True,
                connection_state="streaming",
                fallback_active=False,
                last_error=None,
                source=self.websocket_source,
            )
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=self._stale_after_seconds)
                payload = json.loads(raw)
                data = payload.get("data", payload)
                if not isinstance(data, dict):
                    continue
                await self._handle_ticker_payload(
                    {
                        "symbol": str(data.get("s", "")).upper(),
                        "price": float(data.get("c") or data.get("lastPrice") or 0.0),
                        "change24h": float(data.get("P") or data.get("priceChangePercent") or 0.0),
                        "volume24h": float(data.get("q") or data.get("quoteVolume") or 0.0),
                        "baseVolume24h": float(data.get("v") or data.get("volume") or 0.0),
                    },
                    source=self.websocket_source,
                )


class BitgetPublicMarketDataService(BasePublicMarketDataService):
    def __init__(
        self,
        *,
        symbols: list[str],
        on_market_update: Optional[MarketUpdateHandler] = None,
        on_status_change: Optional[StatusHandler] = None,
        poll_interval_seconds: float = 15.0,
        stale_after_seconds: float = 20.0,
        rest_base_url: str = "https://api.bitget.com",
        ws_base_url: str = "wss://ws.bitget.com/v2/ws/public",
    ) -> None:
        super().__init__(
            exchange="bitget",
            symbols=symbols,
            on_market_update=on_market_update,
            on_status_change=on_status_change,
            poll_interval_seconds=poll_interval_seconds,
            stale_after_seconds=stale_after_seconds,
        )
        self._rest_base_url = rest_base_url.rstrip("/")
        self._ws_base_url = ws_base_url.rstrip("/")

    @property
    def supports_websocket(self) -> bool:
        return True

    @property
    def websocket_source(self) -> str:
        return "bitget-public"

    @property
    def rest_source(self) -> str:
        return "bitget-rest"

    async def _fetch_rest_ticker(self, symbol: str) -> Dict[str, Any]:
        payload = await self._http_get_json(
            f"{self._rest_base_url}/api/v2/spot/market/tickers",
            params={"symbol": symbol},
        )
        data = payload.get("data") or []
        item = data[0] if data else {}
        open24h = _safe_float(item.get("open24h"))
        last_price = _safe_float(item.get("lastPr"))
        change_pct = _safe_float(item.get("change24h"))
        if change_pct == 0.0 and open24h > 0:
            change_pct = ((last_price - open24h) / open24h) * 100.0
        return {
            "symbol": str(item.get("symbol") or item.get("instId") or symbol).upper(),
            "price": last_price,
            "change24h": change_pct,
            "volume24h": _safe_float(item.get("usdtVol") or item.get("quoteVol")),
            "baseVolume24h": _safe_float(item.get("baseVol") or item.get("baseVolume")),
        }

    async def _run_websocket(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets is not installed")
        async with websockets.connect(self._ws_base_url, ping_interval=20, ping_timeout=20) as ws:
            await ws.send(
                json.dumps(
                    {
                        "op": "subscribe",
                        "args": [
                            {"instType": "SPOT", "channel": "ticker", "instId": symbol}
                            for symbol in self.symbols
                        ],
                    }
                )
            )
            await self._set_status(
                market_data_mode="live_public_paper",
                connected=True,
                connection_state="streaming",
                fallback_active=False,
                last_error=None,
                source=self.websocket_source,
            )
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=self._stale_after_seconds)
                payload = json.loads(raw)
                data = payload.get("data") or []
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    open24h = _safe_float(item.get("open24h"))
                    last_price = _safe_float(item.get("lastPr"))
                    change_pct = _safe_float(item.get("change24h"))
                    if change_pct == 0.0 and open24h > 0:
                        change_pct = ((last_price - open24h) / open24h) * 100.0
                    await self._handle_ticker_payload(
                        {
                            "symbol": str(item.get("instId") or item.get("symbol") or "").upper(),
                            "price": last_price,
                            "change24h": change_pct,
                            "volume24h": _safe_float(item.get("usdtVol") or item.get("quoteVol")),
                            "baseVolume24h": _safe_float(item.get("baseVol") or item.get("baseVolume")),
                        },
                        source=self.websocket_source,
                    )


class BTCCPublicMarketDataService(BasePublicMarketDataService):
    def __init__(
        self,
        *,
        symbols: list[str],
        on_market_update: Optional[MarketUpdateHandler] = None,
        on_status_change: Optional[StatusHandler] = None,
        poll_interval_seconds: float = 15.0,
        stale_after_seconds: float = 20.0,
        rest_base_url: str = "https://api.btcc.com",
    ) -> None:
        super().__init__(
            exchange="btcc",
            symbols=symbols,
            on_market_update=on_market_update,
            on_status_change=on_status_change,
            poll_interval_seconds=poll_interval_seconds,
            stale_after_seconds=stale_after_seconds,
        )
        self._rest_base_url = rest_base_url.rstrip("/")

    @property
    def supports_websocket(self) -> bool:
        return False

    @property
    def websocket_source(self) -> str:
        return "btcc-public"

    @property
    def rest_source(self) -> str:
        return "btcc-poll"

    async def _fetch_rest_ticker(self, symbol: str) -> Dict[str, Any]:
        payload = await self._http_get_json(
            f"{self._rest_base_url}/v1/market/ticker",
            params={"symbol": symbol},
        )
        data = payload.get("data") or payload.get("result") or payload
        item = data[0] if isinstance(data, list) and data else data
        if not isinstance(item, dict):
            item = {}
        return {
            "symbol": str(item.get("symbol") or item.get("s") or symbol).upper(),
            "price": _safe_float(item.get("last") or item.get("lastPrice") or item.get("c")),
            "change24h": _safe_float(item.get("priceChangePercent") or item.get("P")),
            "volume24h": _safe_float(item.get("turnover") or item.get("quoteVolume") or item.get("q")),
            "baseVolume24h": _safe_float(item.get("volume") or item.get("v")),
        }


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
