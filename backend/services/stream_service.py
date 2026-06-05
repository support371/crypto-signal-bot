# backend/services/stream_service.py
"""
Canonical /stream WebSocket service.

Publishes typed events to all connected /stream clients:
  - ticker      → { type: "ticker", symbol, price, change24h, volume24h, ts }
  - signal      → { type: "signal", symbol, side, confidence, strategy_id, ts }
  - portfolio   → { type: "portfolio", equity, cash, pnl_pct, open_positions, ts }
  - guardian    → { type: "guardian", triggered, kill_switch_active, drawdown_pct, ts }
  - heartbeat   → { type: "heartbeat", ts, uptime_s }
  - error       → { type: "error", code, message, ts }

Design:
  - Each event type has a fixed schema — no ad-hoc fields.
  - Heartbeat fires every HEARTBEAT_INTERVAL_S (20s).
  - Client can send { "type": "ping" } → server replies { "type": "pong" }.
  - Client can send { "type": "subscribe", "symbols": ["BTCUSDT"] } to filter.
  - Unknown client messages are silently ignored.
  - All errors caught — a bad send never kills other clients.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_S = 20
_START_TIME = time.time()


class StreamClient:
    """Represents a connected /stream WebSocket client."""

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.connected_at = time.time()
        self.subscribed_symbols: Optional[Set[str]] = None  # None = all symbols

    async def send(self, event: Dict[str, Any]) -> bool:
        """Send a typed event. Returns False if send failed (client disconnected)."""
        try:
            await self.ws.send_json(event)
            return True
        except Exception:
            return False

    async def send_text(self, text: str) -> bool:
        """Send a pre-serialized JSON string. Returns False if send failed."""
        try:
            await self.ws.send_text(text)
            return True
        except Exception:
            return False

    def wants_symbol(self, symbol: str) -> bool:
        if self.subscribed_symbols is None:
            return True
        return symbol.upper() in self.subscribed_symbols


class StreamManager:
    """Multi-client stream manager. Thread-safe (asyncio single-threaded)."""

    def __init__(self) -> None:
        self._clients: list[StreamClient] = []

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def connect(self, ws: WebSocket) -> StreamClient:
        await ws.accept()
        client = StreamClient(ws)
        self._clients.append(client)
        log.info("[stream] client connected (total=%d)", len(self._clients))
        return client

    def disconnect(self, client: StreamClient) -> None:
        try:
            self._clients.remove(client)
        except ValueError:
            pass
        log.info("[stream] client disconnected (total=%d)", len(self._clients))

    async def broadcast(self, event: Dict[str, Any]) -> None:
        """Broadcast an event to all connected clients. Dead clients are pruned.

        Optimized: pre-serializes JSON once and uses asyncio.gather for
        concurrent delivery.
        """
        if not self._clients:
            return

        text = json.dumps(event)
        clients = list(self._clients)

        async def _safe_send(client: StreamClient) -> Optional[StreamClient]:
            ok = await client.send_text(text)
            return None if ok else client

        results = await asyncio.gather(*[_safe_send(c) for c in clients])
        dead = [c for c in results if c is not None]
        for d in dead:
            self.disconnect(d)

    async def broadcast_ticker(
        self,
        symbol: str,
        price: float,
        change24h: float,
        volume24h: float,
    ) -> None:
        """Broadcast ticker update. Optimized with pre-serialization."""
        if not self._clients:
            return

        event = {
            "type": "ticker",
            "symbol": symbol,
            "price": price,
            "change24h": change24h,
            "volume24h": volume24h,
            "ts": int(time.time()),
        }
        text = json.dumps(event)
        clients = list(self._clients)

        async def _safe_send(client: StreamClient) -> Optional[StreamClient]:
            if client.wants_symbol(symbol):
                ok = await client.send_text(text)
                return None if ok else client
            return None

        results = await asyncio.gather(*[_safe_send(c) for c in clients])
        dead = [c for c in results if c is not None]
        for d in dead:
            self.disconnect(d)

    async def broadcast_signal(
        self,
        symbol: str,
        side: str,
        confidence: float,
        strategy_id: str,
    ) -> None:
        await self.broadcast({
            "type": "signal",
            "symbol": symbol,
            "side": side,
            "confidence": round(confidence, 4),
            "strategy_id": strategy_id,
            "ts": int(time.time()),
        })

    async def broadcast_portfolio(
        self,
        equity: float,
        cash: float,
        pnl_pct: float,
        open_positions: int,
    ) -> None:
        await self.broadcast({
            "type": "portfolio",
            "equity": round(equity, 2),
            "cash": round(cash, 2),
            "pnl_pct": round(pnl_pct, 4),
            "open_positions": open_positions,
            "ts": int(time.time()),
        })

    async def broadcast_guardian(
        self,
        triggered: bool,
        kill_switch_active: bool,
        drawdown_pct: float,
    ) -> None:
        await self.broadcast({
            "type": "guardian",
            "triggered": triggered,
            "kill_switch_active": kill_switch_active,
            "drawdown_pct": round(drawdown_pct, 4),
            "ts": int(time.time()),
        })

    async def heartbeat_loop(self) -> None:
        """Background task: sends heartbeat every HEARTBEAT_INTERVAL_S seconds."""
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)
            if not self._clients:
                continue
            uptime = int(time.time() - _START_TIME)
            await self.broadcast({
                "type": "heartbeat",
                "ts": int(time.time()),
                "uptime_s": uptime,
                "clients": len(self._clients),
            })


# Singleton — import this everywhere
stream_manager = StreamManager()


async def handle_stream_client(ws: WebSocket) -> None:
    """
    Handle the full lifecycle of a /stream WebSocket connection.

    On connect:
      1. Sends a welcome snapshot (current mode + guardian state).
      2. Enters a receive loop for client messages (ping/subscribe).
      3. On disconnect, removes from manager.
    """
    client = await stream_manager.connect(ws)
    try:
        # Welcome snapshot
        from backend.services.guardian_bot import service as _gsvc
        await client.send({
            "type": "welcome",
            "mode": "paper",
            "protocol_version": "1",
            "events": ["ticker", "signal", "portfolio", "guardian", "heartbeat"],
            "guardian_triggered": _gsvc._triggered,
            "kill_switch_active": _gsvc._kill_switch_active,
            "ts": int(time.time()),
        })

        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_json(), timeout=60.0)
            except asyncio.TimeoutError:
                # No message for 60s — send a keepalive ping
                ok = await client.send({"type": "ping", "ts": int(time.time())})
                if not ok:
                    break
                continue

            msg_type = raw.get("type", "")

            if msg_type == "ping":
                await client.send({"type": "pong", "ts": int(time.time())})

            elif msg_type == "subscribe":
                symbols = raw.get("symbols")
                if isinstance(symbols, list):
                    client.subscribed_symbols = {s.upper() for s in symbols}
                    await client.send({
                        "type": "subscribed",
                        "symbols": list(client.subscribed_symbols),
                        "ts": int(time.time()),
                    })

            elif msg_type == "unsubscribe":
                client.subscribed_symbols = None
                await client.send({"type": "subscribed", "symbols": "all", "ts": int(time.time())})

            # All other messages silently ignored

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("[stream] client error: %s", exc)
    finally:
        stream_manager.disconnect(client)
