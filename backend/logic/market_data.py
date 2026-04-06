"""
Public market-data ingestion for hybrid paper mode.

This service keeps paper execution intact while allowing the backend to consume
live public Binance ticker data for pricing, signal generation, and status.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Dict, Optional

import httpx
import websockets

logger = logging.getLogger("backend.market_data")

MarketUpdateHandler = Callable[[Dict[str, Any]], Awaitable[None]]
StatusHandler = Callable[[Dict[str, Any]], Awaitable[None]]


class BinancePublicMarketDataService:
    """Binance public ticker stream with REST fallback."""

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
        market_cap_quote_volume_multiplier: float = 20.0,
    ) -> None:
        self.symbols = [symbol.upper() for symbol in symbols]
        self._on_market_update = on_market_update
        self._on_status_change = on_status_change
        self._poll_interval_seconds = poll_interval_seconds
        self._stale_after_seconds = stale_after_seconds
        self._rest_base_url = rest_base_url.rstrip("/")
        self._ws_base_url = ws_base_url.rstrip("/")
        self._market_cap_quote_volume_multiplier = market_cap_quote_volume_multiplier

        self._task: Optional[asyncio.Task[None]] = None
        self._http: Optional[httpx.AsyncClient] = None
        self._snapshots: Dict[str, Dict[str, Any]] = {}
        self._status: Dict[str, Any] = {
            "exchange": "binance",
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
        self._task = asyncio.create_task(self._run(), name="binance-public-market-data")

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
                await self._set_status(
                    market_data_mode="live_public_paper",
                    connected=False,
                    connection_state="connecting",
                    fallback_active=False,
                    source="binance-public",
                )
                await self._run_websocket()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Binance websocket feed failed: %s", exc)
                await self._set_status(
                    market_data_mode="live_public_paper",
                    connected=False,
                    connection_state="polling",
                    fallback_active=True,
                    last_error=str(exc),
                    source="binance-rest",
                )
                try:
                    await self._poll_once()
                except Exception as poll_exc:
                    logger.warning("Binance REST fallback failed: %s", poll_exc)
                    await self._set_status(last_error=str(poll_exc))
                await asyncio.sleep(self._poll_interval_seconds)

    async def _run_websocket(self) -> None:
        streams = "/".join(f"{symbol.lower()}@ticker" for symbol in self.symbols)
        url = f"{self._ws_base_url}?streams={streams}"

        async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
            await self._set_status(
                market_data_mode="live_public_paper",
                connected=True,
                connection_state="streaming",
                fallback_active=False,
                last_error=None,
                source="binance-public",
            )
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=self._stale_after_seconds)
                payload = json.loads(raw)
                data = payload.get("data", payload)
                if isinstance(data, dict):
                    await self._handle_ticker_payload(data, source="binance-public")

    async def _seed_from_rest(self) -> None:
        try:
            await self._poll_once()
        except Exception as exc:
            logger.warning("Initial Binance REST seed failed: %s", exc)
            await self._set_status(
                market_data_mode="live_public_paper",
                connected=False,
                connection_state="polling",
                fallback_active=True,
                last_error=str(exc),
                source="binance-rest",
            )

    async def _poll_once(self) -> None:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=10.0)

        for symbol in self.symbols:
            response = await self._http.get(
                f"{self._rest_base_url}/api/v3/ticker/24hr",
                params={"symbol": symbol},
            )
            response.raise_for_status()
            await self._handle_ticker_payload(response.json(), source="binance-rest")

    async def _handle_ticker_payload(self, payload: Dict[str, Any], *, source: str) -> None:
        symbol = str(payload.get("s", "")).upper()
        if symbol not in self.symbols:
            return

        price = float(payload.get("c") or payload.get("lastPrice") or 0.0)
        change24h = float(payload.get("P") or payload.get("priceChangePercent") or 0.0)
        quote_volume = float(payload.get("q") or payload.get("quoteVolume") or 0.0)
        base_volume = float(payload.get("v") or payload.get("volume") or 0.0)
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
        }
        self._snapshots[symbol] = snapshot

        await self._set_status(
            market_data_mode="live_public_paper",
            connected=True,
            connection_state="streaming" if source == "binance-public" else "polling",
            fallback_active=source != "binance-public",
            last_update_ts=last_update_ts,
            last_error=None,
            source=source,
        )

        if self._on_market_update is not None:
            await self._on_market_update(dict(snapshot))

    def _estimate_market_cap(self, price: float, quote_volume: float) -> float:
        # Heuristic fallback for hybrid paper mode when no market-cap source is available.
        return max(quote_volume * self._market_cap_quote_volume_multiplier, price * 1_000_000.0)

    async def _set_status(self, **updates: Any) -> None:
        changed = False
        for key, value in updates.items():
            if self._status.get(key) != value:
                self._status[key] = value
                changed = True

        if changed and self._on_status_change is not None:
            await self._on_status_change(self.get_status())
