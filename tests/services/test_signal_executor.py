# tests/services/test_signal_executor.py
"""
Unit tests for the signal executor service.

Covers:
  - _executor_sweep: no-op when signal unchanged
  - _executor_sweep: opens position on new BUY signal
  - _executor_sweep: closes existing long on SELL flip
  - _executor_sweep: closes position when signal goes FLAT
  - _executor_sweep: skips if confidence < MIN_CONFIDENCE
  - get_executor_status: returns correct shape
  - probe_executor: ok when running, failing when not
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import backend.services.signal_executor.service as svc


@dataclass
class FakeSignalRecord:
    symbol: str = "BTCUSDT"
    timeframe: str = "1h"
    side: str = "BUY"
    entry_price: float = 68000.0
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    confidence: float = 0.80
    strategy_id: str = "combined"
    created_at: int = 0
    valid_until: int = 0
    id: str = "sig-001"
    metadata: Dict[str, Any] = field(default_factory=dict)


def _sig(**overrides) -> FakeSignalRecord:
    return FakeSignalRecord(**overrides)


def _guardian_ok():
    return MagicMock(kill_switch_active=False)


@pytest.fixture(autouse=True)
def reset_executor_state():
    """Reset module-level executor state before each test."""
    svc._last_acted.clear()
    svc._running = False
    svc._run_count = 0
    svc._last_run_at = 0
    svc._nav_anchored = True
    yield
    svc._last_acted.clear()


class _SweepCtx:
    """Patches _executor_sweep dependencies and tracks orders."""

    def __init__(self, signals, equity=10000.0, positions=None):
        self._signals = signals
        self._equity = equity
        self._positions = positions or []
        self.submitted_orders = []
        self._patches = []

    async def _do_submit(self, sym, side, qty, price):
        self.submitted_orders.append(
            {"symbol": sym, "side": side, "qty": qty, "price": price}
        )
        return {}

    def __enter__(self):
        ps = [
            patch(
                "backend.services.guardian_bot.service"
                ".get_guardian_status",
                new_callable=AsyncMock,
                return_value=_guardian_ok(),
            ),
            patch(
                "backend.services.signal_service.service"
                ".get_all_cached_signals",
                return_value=self._signals,
            ),
            patch.object(
                svc, "_get_equity",
                new_callable=AsyncMock,
                return_value=self._equity,
            ),
            patch.object(
                svc, "_get_open_positions",
                new_callable=AsyncMock,
                return_value=self._positions,
            ),
            patch.object(
                svc, "submit_order",
                new_callable=AsyncMock,
                side_effect=self._do_submit,
            ),
            patch.object(
                svc, "_anchor_nav_on_start",
                new_callable=AsyncMock,
            ),
            patch.object(
                svc, "_fire_trade_alert",
                new_callable=AsyncMock,
            ),
        ]
        self._patches = ps
        for p in ps:
            p.start()
        return self

    def __exit__(self, *args):
        for p in reversed(self._patches):
            p.stop()


# -------------------------------------------------------------------
# get_executor_status
# -------------------------------------------------------------------

class TestGetExecutorStatus:
    def test_returns_required_keys(self):
        status = svc.get_executor_status()
        assert "running" in status
        assert "run_count" in status
        assert "executor_interval" in status
        assert "min_confidence" in status
        assert "position_pct" in status
        assert "last_acted" in status

    def test_last_acted_reflects_state(self):
        svc._last_acted["BTCUSDT"] = ("BUY", "combined")
        status = svc.get_executor_status()
        assert status["last_acted"]["BTCUSDT"]["side"] == "BUY"


# -------------------------------------------------------------------
# No-op when signal unchanged
# -------------------------------------------------------------------

class TestSweepNoOp:
    @pytest.mark.asyncio
    async def test_no_order_when_signal_unchanged(self):
        svc._last_acted["BTCUSDT"] = ("BUY", "combined", 68000.0)
        sig = _sig(
            symbol="BTCUSDT", side="BUY",
            strategy_id="combined", entry_price=68000.0,
        )
        with _SweepCtx([sig]) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 0

    @pytest.mark.asyncio
    async def test_no_order_when_flat_no_position(self):
        sig = _sig(
            symbol="BTCUSDT", side="FLAT",
            confidence=0.0, entry_price=68000.0,
        )
        with _SweepCtx([sig]) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 0


# -------------------------------------------------------------------
# Confidence gate
# -------------------------------------------------------------------

class TestConfidenceGate:
    @pytest.mark.asyncio
    async def test_skips_below_threshold(self):
        sig = _sig(
            symbol="ETHUSDT", side="BUY",
            confidence=0.40, entry_price=3000.0,
        )
        with _SweepCtx([sig]) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 0
        assert "ETHUSDT" not in svc._last_acted

    @pytest.mark.asyncio
    async def test_executes_at_threshold(self):
        sig = _sig(
            symbol="ETHUSDT", side="BUY",
            confidence=svc.MIN_CONFIDENCE,
            entry_price=3000.0,
        )
        with _SweepCtx([sig], equity=10000.0) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 1
        assert ctx.submitted_orders[0]["side"] == "BUY"
        acted = svc._last_acted.get("ETHUSDT")
        assert acted is not None
        assert acted[0] == "BUY"


# -------------------------------------------------------------------
# Opens BUY on new signal
# -------------------------------------------------------------------

class TestOpenOnBuySignal:
    @pytest.mark.asyncio
    async def test_opens_buy_order(self):
        sig = _sig(
            symbol="SOLUSDT", side="BUY",
            confidence=0.75, entry_price=150.0,
        )
        with _SweepCtx([sig]) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 1
        assert ctx.submitted_orders[0]["side"] == "BUY"
        assert ctx.submitted_orders[0]["symbol"] == "SOLUSDT"

    @pytest.mark.asyncio
    async def test_qty_sized_by_equity(self):
        equity = 10000.0
        price = 100.0
        expected_qty = (equity * svc.POSITION_PCT) / price
        sig = _sig(
            symbol="LINKUSDT", side="BUY",
            confidence=0.80, entry_price=price,
        )
        with _SweepCtx([sig], equity=equity) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 1
        assert ctx.submitted_orders[0]["qty"] == pytest.approx(
            expected_qty,
        )

    @pytest.mark.asyncio
    async def test_state_updated_after_open(self):
        sig = _sig(
            symbol="BNBUSDT", side="BUY",
            confidence=0.80, entry_price=400.0,
        )
        with _SweepCtx([sig]):
            await svc._executor_sweep()
        assert svc._last_acted["BNBUSDT"][0] == "BUY"
        assert svc._last_acted["BNBUSDT"][1] == "combined"


# -------------------------------------------------------------------
# BUY flip to SELL (long-only: close, no short)
# -------------------------------------------------------------------

class TestFlipBuyToSell:
    @pytest.mark.asyncio
    async def test_closes_long_on_sell_signal(self):
        svc._last_acted["BTCUSDT"] = (
            "BUY", "combined", 74000.0,
        )
        sig = _sig(
            symbol="BTCUSDT", side="SELL",
            confidence=0.80, entry_price=74000.0,
        )
        positions = [{"symbol": "BTCUSDT", "qty": 0.135}]
        with _SweepCtx([sig], positions=positions) as ctx:
            await svc._executor_sweep()
        sells = [
            o for o in ctx.submitted_orders
            if o["side"] == "SELL"
        ]
        assert len(sells) >= 1
        assert sells[0]["symbol"] == "BTCUSDT"
        assert sells[0]["qty"] == pytest.approx(0.135)


# -------------------------------------------------------------------
# Signal goes FLAT — close position, no new open
# -------------------------------------------------------------------

class TestSignalGoesFlat:
    @pytest.mark.asyncio
    async def test_closes_position_on_flat(self):
        svc._last_acted["XRPUSDT"] = ("BUY", "combined", 0.5)
        sig = _sig(
            symbol="XRPUSDT", side="FLAT",
            confidence=0.0, entry_price=0.5,
        )
        positions = [{"symbol": "XRPUSDT", "qty": 500.0}]
        with _SweepCtx([sig], positions=positions) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 1
        assert ctx.submitted_orders[0]["side"] == "SELL"
        assert "XRPUSDT" not in svc._last_acted

    @pytest.mark.asyncio
    async def test_no_close_if_no_open_position(self):
        svc._last_acted["DOGEUSDT"] = (
            "BUY", "combined", 0.1,
        )
        sig = _sig(
            symbol="DOGEUSDT", side="FLAT",
            confidence=0.0, entry_price=0.1,
        )
        with _SweepCtx([sig], positions=[]) as ctx:
            await svc._executor_sweep()
        assert len(ctx.submitted_orders) == 0


# -------------------------------------------------------------------
# probe_executor
# -------------------------------------------------------------------

class TestProbeExecutor:
    @pytest.mark.asyncio
    async def test_ok_when_running(self):
        from backend.services.monitoring.probes import probe_executor
        with patch(
            "backend.services.monitoring.probes._get_exec_status",
            return_value={
                "running": True, "run_count": 5,
                "last_run_at": int(time.time()),
                "min_confidence": 0.60,
                "position_pct": 0.10,
            },
        ):
            result = await probe_executor()
        assert result.ok is True
        assert result.name == "executor"

    @pytest.mark.asyncio
    async def test_failing_when_not_running(self):
        from backend.services.monitoring.probes import probe_executor
        with patch(
            "backend.services.monitoring.probes._get_exec_status",
            return_value={
                "running": False, "run_count": 0,
                "last_run_at": 0,
                "min_confidence": 0.60,
                "position_pct": 0.10,
            },
        ):
            result = await probe_executor()
        assert result.ok is False

    @pytest.mark.asyncio
    async def test_failing_when_import_error(self):
        from backend.services.monitoring.probes import probe_executor
        with patch(
            "backend.services.monitoring.probes._get_exec_status",
            side_effect=ImportError("not available"),
        ):
            result = await probe_executor()
        assert result.ok is False


# -------------------------------------------------------------------
# Monitor probe count
# -------------------------------------------------------------------

class TestProbeCount:
    @pytest.mark.asyncio
    async def test_probe_count_is_nine(self):
        from httpx import ASGITransport, AsyncClient
        from backend.app import app

        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url="http://test",
        ) as c:
            resp = await c.get("/api/v1/monitor/probes")
        body = resp.json()
        assert "executor" in body["probes"]
        assert body["count"] == 9
