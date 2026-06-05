"""
WebSocket connection manager with heartbeat and ticker broadcast.

Provides:
  - ConnectionManager: persistent multi-client WS manager with ping/pong
  - broadcast_ticker_loop: async task that streams BTC/ETH/SOL/BNB prices
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket
from backend.services.stream_service import stream_manager as _stream_manager

logger = logging.getLogger(__name__)

# Symbols to broadcast
TICKER_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]

# Base prices for deterministic simulation when live feed unavailable
_BASE_PRICES: Dict[str, float] = {
    "BTCUSDT": 68000.0,
    "ETHUSDT": 3800.0,
    "SOLUSDT": 175.0,
    "BNBUSDT": 610.0,
}


class ConnectionManager:
    """Manages WebSocket connections with heartbeat support."""

    def __init__(self) -> None:
        self._active: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._active.add(ws)
        logger.info("WS client connected (%d total)", len(self._active))
        # Send initial status
        try:
            await ws.send_json({
                "type": "status",
                "ws": "online",
                "backend": "operational",
            })
        except Exception:
            pass

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._active.discard(ws)
        logger.info("WS client disconnected (%d remaining)", len(self._active))

    @property
    def client_count(self) -> int:
        return len(self._active)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast a message to all connected clients.

        Optimized: pre-serializes JSON once and uses asyncio.gather for
        concurrent delivery, reducing O(N) serialization to O(1) and
        minimizing total broadcast latency.
        """
        async with self._lock:
            clients = list(self._active)
        if not clients:
            return

        # Pre-serialize payload to avoid redundant work for each client
        text = json.dumps(message)

        async def _safe_send(ws: WebSocket) -> Optional[WebSocket]:
            try:
                # Use send_text with pre-serialized JSON
                await ws.send_text(text)
                return None
            except Exception:
                return ws

        # Concurrently send to all clients
        results = await asyncio.gather(*[_safe_send(ws) for ws in clients])

        # Prune dead connections
        dead = [ws for ws in results if ws is not None]
        if dead:
            async with self._lock:
                for ws in dead:
                    self._active.discard(ws)

    async def send_personal(self, ws: WebSocket, message: Dict[str, Any]) -> None:
        try:
            await ws.send_json(message)
        except Exception:
            pass

    async def heartbeat_loop(self) -> None:
        """Send ping to all clients every 10s to keep connections alive."""
        while True:
            await asyncio.sleep(10)
            async with self._lock:
                clients = list(self._active)
            dead: List[WebSocket] = []
            for ws in clients:
                try:
                    await ws.send_json({
                        "type": "ping",
                        "timestamp": time.time(),
                    })
                except Exception:
                    dead.append(ws)
            if dead:
                async with self._lock:
                    for ws in dead:
                        self._active.discard(ws)


# Singleton instance
manager = ConnectionManager()


def _simulated_price(symbol: str, t: float) -> float:
    """Deterministic smooth oscillation around base price."""
    base = _BASE_PRICES.get(symbol, 100.0)
    # Multi-frequency oscillation for realistic-looking movement
    wave1 = math.sin(t / 30.0) * 0.005
    wave2 = math.sin(t / 7.0 + 1.5) * 0.002
    wave3 = math.sin(t / 120.0 + 3.0) * 0.01
    noise = math.sin(t * 1.7 + hash(symbol) % 100) * 0.001
    return round(base * (1 + wave1 + wave2 + wave3 + noise), 2)


def _simulated_change(symbol: str, t: float) -> float:
    """Deterministic 24h change percentage."""
    wave = math.sin(t / 600.0 + hash(symbol) % 50) * 3.0
    return round(wave, 4)


async def broadcast_ticker_loop(
    get_live_price=None,
    interval: float = 3.0,
) -> None:
    """Broadcast ticker updates for BTC/ETH/SOL/BNB every `interval` seconds.

    If `get_live_price` is provided, it should be a callable(symbol) -> float|None.
    Falls back to deterministic simulation if live data unavailable.
    """
    logger.info("Ticker broadcast loop started (interval=%.1fs)", interval)
    while True:
        t = time.time()
        for symbol in TICKER_SYMBOLS:
            price = None
            change = None

            # Try live price first
            if get_live_price is not None:
                try:
                    price = get_live_price(symbol)
                except Exception:
                    pass

            # Fall back to simulation
            if price is None:
                price = _simulated_price(symbol, t)
                change = _simulated_change(symbol, t)
            else:
                change = _simulated_change(symbol, t)

            await manager.broadcast({
                "type": "ticker",
                "symbol": symbol,
                "price": price,
                "change": change,
                "timestamp": t,
            })
            # Also push to canonical /stream endpoint
            try:
                await _stream_manager.broadcast_ticker(
                    symbol=symbol,
                    price=float(price) if price else 0.0,
                    change24h=float(change) if change else 0.0,
                    volume24h=0.0,
                )
            except Exception:
                pass

        # Also broadcast status
        await manager.broadcast({
            "type": "status",
            "ws": "online",
            "backend": "operational",
        })

        await asyncio.sleep(interval)
