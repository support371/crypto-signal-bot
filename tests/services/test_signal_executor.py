# tests/services/test_signal_executor.py
"""
Unit tests for the signal executor service.

Covers:
  - _execute_symbol: no-op when signal unchanged
  - _execute_symbol: opens position on new BUY signal
  - _execute_symbol: closes existing long and opens short on SELL flip
  - _execute_symbol: closes position when signal goes FLAT
  - _execute_symbol: skips if confidence < MIN_CONFIDENCE
  - get_executor_status: returns correct shape
  - probe_executor: ok when running, failing when not
"""
from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import backend.services.signal_executor.service as svc


def _sig(symbol="BTCUSDT", side="BUY", strategy_id="combined", confidence=0.80):
    return SimpleNamespace(
        symbol=symbol, side=side,
        strategy_id=strategy_id, confidence=confidence,
    )


@pytest.fixture(autouse=True)
def reset_executor_state():
    """Reset all module-level executor state before each test."""
    svc._last_acted.clear()
    svc._running    = False
    svc._run_count  = 0
    svc._last_run_at = 0
    yield
    svc._last_acted.clear()


# ---------------------------------------------------------------------------
# get_executor_status
# ---------------------------------------------------------------------------

class TestGetExecutorStatus:
    def test_returns_required_keys(self):
        status = svc.get_executor_status()
        assert "running"           in status
        assert "run_count"         in status
        assert "executor_interval" in status
        assert "min_confidence"    in status
        assert "position_pct"      in status
        assert "last_acted"        in status

    def test_last_acted_reflects_state(self):
        svc._last_acted["BTCUSDT"] = ("BUY", "combined")
        status = svc.get_executor_status()
        assert status["last_acted"]["BTCUSDT"]["side"] == "BUY"


# ---------------------------------------------------------------------------
# _execute_symbol — no-op when signal unchanged
# ---------------------------------------------------------------------------

class TestExecuteSymbolNoOp:
    @pytest.mark.asyncio
    async def test_no_order_when_signal_unchanged(self):
        svc._last_acted["BTCUSDT"] = ("BUY", "combined")
        sig = _sig("BTCUSDT", "BUY", "combined", confidence=0.80)
        with patch("backend.services.portfolio.service.submit_order",
                   new_callable=AsyncMock) as mock_order:
            await svc._execute_symbol("BTCUSDT", sig)
        mock_order.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_order_when_flat_and_prev_flat(self):
        # FLAT → FLAT should be a no-op
        sig = _sig("BTCUSDT", "FLAT", "combined", confidence=0.0)
        with patch("backend.services.portfolio.service.submit_order",
                   new_callable=AsyncMock) as mock_order:
            await svc._execute_symbol("BTCUSDT", sig)
        mock_order.assert_not_called()


# ---------------------------------------------------------------------------
# _execute_symbol — confidence gate
# ---------------------------------------------------------------------------

class TestConfidenceGate:
    @pytest.mark.asyncio
    async def test_skips_when_confidence_below_threshold(self):
        sig = _sig("ETHUSDT", "BUY", "combined", confidence=0.40)
        with patch("backend.services.portfolio.service.submit_order",
                   new_callable=AsyncMock) as mock_order:
            await svc._execute_symbol("ETHUSDT", sig)
        mock_order.assert_not_called()
        # State should NOT be updated — we haven't acted
        assert "ETHUSDT" not in svc._last_acted

    @pytest.mark.asyncio
    async def test_executes_when_confidence_at_threshold(self):
        sig = _sig("ETHUSDT", "BUY", "combined", confidence=svc.MIN_CONFIDENCE)
        mock_snap = MagicMock(); mock_snap.price = "3000.00"

        with (
            patch("backend.services.portfolio.service.submit_order",
                  new_callable=AsyncMock,
                  return_value=MagicMock(id="order-abc", status="FILLED")),
            patch("backend.services.market_data.service.get_price",
                  new_callable=AsyncMock, return_value=mock_snap),
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=10000.0),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=0.0),
        ):
            await svc._execute_symbol("ETHUSDT", sig)

        assert svc._last_acted.get("ETHUSDT") == ("BUY", "combined")


# ---------------------------------------------------------------------------
# _execute_symbol — opens BUY on new signal
# ---------------------------------------------------------------------------

class TestOpenOnBuySignal:
    @pytest.mark.asyncio
    async def test_opens_buy_order_on_new_signal(self):
        sig = _sig("SOLUSDT", "BUY", "combined", confidence=0.75)
        mock_snap = MagicMock(); mock_snap.price = "150.00"
        mock_order = MagicMock(id="ord-001", status="FILLED")

        with (
            patch("backend.services.portfolio.service.submit_order",
                  new_callable=AsyncMock, return_value=mock_order) as mock_sub,
            patch("backend.services.market_data.service.get_price",
                  new_callable=AsyncMock, return_value=mock_snap),
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=10000.0),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=0.0),
        ):
            await svc._execute_symbol("SOLUSDT", sig)

        # Should have called submit_order once with BUY
        mock_sub.assert_called_once()
        call_kwargs = mock_sub.call_args.kwargs
        assert call_kwargs["side"] == "BUY"
        assert call_kwargs["symbol"] == "SOLUSDT"
        assert call_kwargs["order_type"] == "MARKET"

    @pytest.mark.asyncio
    async def test_qty_sized_by_equity_and_position_pct(self):
        equity = 10000.0
        price  = 100.0
        expected_qty = (equity * svc.POSITION_PCT) / price

        sig = _sig("LINKUSDT", "BUY", "combined", confidence=0.80)
        mock_snap = MagicMock(); mock_snap.price = str(price)
        mock_order = MagicMock(id="ord-002", status="FILLED")

        with (
            patch("backend.services.portfolio.service.submit_order",
                  new_callable=AsyncMock, return_value=mock_order) as mock_sub,
            patch("backend.services.market_data.service.get_price",
                  new_callable=AsyncMock, return_value=mock_snap),
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=equity),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=0.0),
        ):
            await svc._execute_symbol("LINKUSDT", sig)

        call_kwargs = mock_sub.call_args.kwargs
        assert call_kwargs["qty"] == pytest.approx(expected_qty)

    @pytest.mark.asyncio
    async def test_state_updated_after_open(self):
        sig = _sig("BNBUSDT", "BUY", "combined", confidence=0.80)
        mock_snap = MagicMock(); mock_snap.price = "400.0"

        with (
            patch("backend.services.portfolio.service.submit_order",
                  new_callable=AsyncMock,
                  return_value=MagicMock(id="ord-003", status="FILLED")),
            patch("backend.services.market_data.service.get_price",
                  new_callable=AsyncMock, return_value=mock_snap),
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=10000.0),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=0.0),
        ):
            await svc._execute_symbol("BNBUSDT", sig)

        assert svc._last_acted["BNBUSDT"] == ("BUY", "combined")


# ---------------------------------------------------------------------------
# _execute_symbol — BUY flip to SELL (close long, open short)
# ---------------------------------------------------------------------------

class TestFlipBuyToSell:
    @pytest.mark.asyncio
    async def test_closes_long_then_opens_sell(self):
        svc._last_acted["BTCUSDT"] = ("BUY", "combined")
        sig = _sig("BTCUSDT", "SELL", "combined", confidence=0.80)
        mock_snap = MagicMock(); mock_snap.price = "74000.0"
        orders = []

        async def mock_submit(**kw):
            o = MagicMock(id=f"ord-{kw['side']}", status="FILLED")
            orders.append(kw["side"])
            return o

        with (
            patch("backend.services.portfolio.service.submit_order",
                  side_effect=mock_submit),
            patch("backend.services.market_data.service.get_price",
                  new_callable=AsyncMock, return_value=mock_snap),
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=10000.0),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=0.135),
        ):
            await svc._execute_symbol("BTCUSDT", sig)

        # Long-only paper mode: SELL signal closes the long, does NOT open a short.
        assert orders[0] == "SELL"    # close long
        assert len(orders) == 1       # no naked short opened
        assert svc._last_acted["BTCUSDT"] == ("SELL", "combined")


# ---------------------------------------------------------------------------
# _execute_symbol — signal goes FLAT (close position, no new open)
# ---------------------------------------------------------------------------

class TestSignalGoesFlat:
    @pytest.mark.asyncio
    async def test_closes_position_on_flat(self):
        svc._last_acted["XRPUSDT"] = ("BUY", "combined")
        sig = _sig("XRPUSDT", "FLAT", "no_data", confidence=0.0)
        closed = []

        async def mock_submit(**kw):
            closed.append(kw["side"])
            return MagicMock(id="ord-close", status="FILLED")

        with (
            patch("backend.services.portfolio.service.submit_order",
                  side_effect=mock_submit),
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=10000.0),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=500.0),
        ):
            await svc._execute_symbol("XRPUSDT", sig)

        assert "SELL" in closed     # position closed
        assert len(closed) == 1     # no new position opened
        assert svc._last_acted["XRPUSDT"] == ("FLAT", "no_data")

    @pytest.mark.asyncio
    async def test_no_close_if_no_open_position_on_flat(self):
        svc._last_acted["DOGEUSDT"] = ("BUY", "combined")
        sig = _sig("DOGEUSDT", "FLAT", "no_data", confidence=0.0)

        with (
            patch("backend.services.portfolio.service.submit_order",
                  new_callable=AsyncMock) as mock_sub,
            patch.object(svc, "_get_equity", new_callable=AsyncMock, return_value=10000.0),
            patch.object(svc, "_get_open_qty", new_callable=AsyncMock, return_value=0.0),
        ):
            await svc._execute_symbol("DOGEUSDT", sig)

        mock_sub.assert_not_called()


# ---------------------------------------------------------------------------
# probe_executor
# ---------------------------------------------------------------------------

class TestProbeExecutor:
    @pytest.mark.asyncio
    async def test_ok_when_running(self):
        from backend.services.monitoring.probes import probe_executor
        with patch(
            "backend.services.monitoring.probes._get_exec_status",
            return_value={"running": True, "run_count": 5,
                          "last_run_at": int(time.time()),
                          "min_confidence": 0.60, "position_pct": 0.10},
        ):
            result = await probe_executor()
        assert result.ok is True
        assert result.name == "executor"

    @pytest.mark.asyncio
    async def test_failing_when_not_running(self):
        from backend.services.monitoring.probes import probe_executor
        with patch(
            "backend.services.monitoring.probes._get_exec_status",
            return_value={"running": False, "run_count": 0,
                          "last_run_at": 0,
                          "min_confidence": 0.60, "position_pct": 0.10},
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


# ---------------------------------------------------------------------------
# Monitor probe count updated to 9
# ---------------------------------------------------------------------------

class TestProbeCount:
    @pytest.mark.asyncio
    async def test_probe_count_is_nine(self):
        from httpx import ASGITransport, AsyncClient
        from backend.app import app
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get("/api/v1/monitor/probes")
        body = resp.json()
        assert "executor" in body["probes"]
        assert body["count"] == 9
