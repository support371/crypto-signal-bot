"""Tests for the WebSocket manager (backend/services/websocket_manager.py)."""

import asyncio
import math

import pytest

from backend.services.websocket_manager import (
    ConnectionManager,
    _simulated_price,
    _simulated_change,
    _BASE_PRICES,
    TICKER_SYMBOLS,
)


class _FakeWebSocket:
    """Minimal stub that records send_json calls."""

    def __init__(self, *, fail_on_send=False):
        self.accepted = False
        self.messages = []
        self._fail = fail_on_send

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        if self._fail:
            raise ConnectionError("connection lost")
        self.messages.append(data)


class TestConnectionManager:
    @pytest.fixture
    def mgr(self):
        return ConnectionManager()

    @pytest.mark.asyncio
    async def test_connect_accepts(self, mgr):
        ws = _FakeWebSocket()
        await mgr.connect(ws)
        assert ws.accepted
        assert mgr.client_count == 1

    @pytest.mark.asyncio
    async def test_connect_sends_status(self, mgr):
        ws = _FakeWebSocket()
        await mgr.connect(ws)
        assert any(m.get("type") == "status" for m in ws.messages)

    @pytest.mark.asyncio
    async def test_disconnect(self, mgr):
        ws = _FakeWebSocket()
        await mgr.connect(ws)
        await mgr.disconnect(ws)
        assert mgr.client_count == 0

    @pytest.mark.asyncio
    async def test_disconnect_idempotent(self, mgr):
        ws = _FakeWebSocket()
        await mgr.connect(ws)
        await mgr.disconnect(ws)
        await mgr.disconnect(ws)
        assert mgr.client_count == 0

    @pytest.mark.asyncio
    async def test_broadcast(self, mgr):
        ws1, ws2 = _FakeWebSocket(), _FakeWebSocket()
        await mgr.connect(ws1)
        await mgr.connect(ws2)
        await mgr.broadcast({"type": "test", "value": 42})
        assert any(m.get("value") == 42 for m in ws1.messages)
        assert any(m.get("value") == 42 for m in ws2.messages)

    @pytest.mark.asyncio
    async def test_broadcast_removes_dead_clients(self, mgr):
        ws_ok = _FakeWebSocket()
        ws_bad = _FakeWebSocket(fail_on_send=True)
        await mgr.connect(ws_ok)
        await mgr.connect(ws_bad)
        assert mgr.client_count == 2
        await mgr.broadcast({"type": "test"})
        assert mgr.client_count == 1

    @pytest.mark.asyncio
    async def test_send_personal(self, mgr):
        ws = _FakeWebSocket()
        await mgr.connect(ws)
        await mgr.send_personal(ws, {"type": "personal", "data": "hi"})
        assert any(m.get("type") == "personal" for m in ws.messages)

    @pytest.mark.asyncio
    async def test_send_personal_failure_silent(self, mgr):
        ws = _FakeWebSocket(fail_on_send=True)
        await mgr.send_personal(ws, {"type": "noop"})


class TestSimulatedPrice:
    def test_returns_float(self):
        p = _simulated_price("BTCUSDT", 1000.0)
        assert isinstance(p, float)

    def test_near_base(self):
        p = _simulated_price("BTCUSDT", 0.0)
        base = _BASE_PRICES["BTCUSDT"]
        assert abs(p - base) / base < 0.03

    def test_deterministic(self):
        p1 = _simulated_price("ETHUSDT", 500.0)
        p2 = _simulated_price("ETHUSDT", 500.0)
        assert p1 == p2

    def test_varies_over_time(self):
        prices = {_simulated_price("BTCUSDT", t) for t in range(0, 300, 10)}
        assert len(prices) > 1

    def test_all_symbols(self):
        for sym in TICKER_SYMBOLS:
            p = _simulated_price(sym, 100.0)
            assert p > 0


class TestSimulatedChange:
    def test_returns_float(self):
        c = _simulated_change("BTCUSDT", 1000.0)
        assert isinstance(c, float)

    def test_bounded(self):
        for t in range(0, 1000, 50):
            c = _simulated_change("BTCUSDT", float(t))
            assert abs(c) < 5.0

    def test_deterministic(self):
        c1 = _simulated_change("SOLUSDT", 200.0)
        c2 = _simulated_change("SOLUSDT", 200.0)
        assert c1 == c2
