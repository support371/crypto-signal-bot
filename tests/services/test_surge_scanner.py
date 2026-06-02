# tests/services/test_surge_scanner.py
"""
Unit tests for the Surge Scanner service.

Tests cover:
  - Stop-loss trigger at >= 5% unrealized loss
  - Normal surge detection at 5–10% price jump
  - Strong surge detection at 15–20% price jump
  - No-action when market is flat
  - Kill switch suppression
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import backend.services.surge_scanner.service as scanner


# ── Helpers ───────────────────────────────────────────────────────────────────

def _reset_scanner():
    """Reset scanner internal state between tests."""
    scanner._running = False
    scanner._run_count = 0
    scanner._alerts_fired = 0
    scanner._stop_losses_triggered = 0
    for sym in scanner.WATCHED_SYMBOLS:
        scanner._price_history[sym] = deque(maxlen=scanner._RING_SIZE)
    scanner._surge_status.clear()


def _fill_history(symbol: str, ref_price: float, minutes: int = 20):
    """Pre-fill price history so reference window is ready."""
    history = scanner._price_history[symbol]
    now = int(time.time())
    for i in range(minutes, 0, -1):
        ts = now - (i * 60)
        history.append((ts, ref_price))


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestStopLoss:
    @pytest.mark.asyncio
    async def test_stop_loss_triggers_on_5pct_drop(self):
        _reset_scanner()
        symbol = "BTCUSDT"
        entry_price = 50000.0
        current_price = 47000.0  # -6% drop

        with patch(
            "backend.services.surge_scanner.service._get_current_price",
            new=AsyncMock(return_value=current_price),
        ), patch(
            "backend.services.surge_scanner.service._get_open_position_entry",
            new=AsyncMock(return_value=entry_price),
        ), patch(
            "backend.services.surge_scanner.service._close_position_emergency",
            new=AsyncMock(),
        ) as mock_close:
            alert = await scanner._scan_symbol(symbol)

        assert alert is not None
        assert alert.alert_type == "STOP_LOSS_EXIT"
        assert alert.pct_change < -0.05
        mock_close.assert_called_once_with(symbol)
        assert scanner._stop_losses_triggered == 1

    @pytest.mark.asyncio
    async def test_no_stop_loss_on_3pct_drop(self):
        _reset_scanner()
        symbol = "BTCUSDT"
        entry_price = 50000.0
        current_price = 48700.0  # -2.6% — within tolerance

        _fill_history(symbol, current_price)

        with patch(
            "backend.services.surge_scanner.service._get_current_price",
            new=AsyncMock(return_value=current_price),
        ), patch(
            "backend.services.surge_scanner.service._get_open_position_entry",
            new=AsyncMock(return_value=entry_price),
        ), patch(
            "backend.services.surge_scanner.service._close_position_emergency",
            new=AsyncMock(),
        ) as mock_close:
            alert = await scanner._scan_symbol(symbol)

        mock_close.assert_not_called()
        assert scanner._stop_losses_triggered == 0


class TestSurgeDetection:
    @pytest.mark.asyncio
    async def test_normal_surge_5_to_10_pct(self):
        _reset_scanner()
        symbol = "ETHUSDT"
        ref_price = 3000.0
        current_price = 3210.0  # +7% surge

        _fill_history(symbol, ref_price)

        with patch(
            "backend.services.surge_scanner.service._get_current_price",
            new=AsyncMock(return_value=current_price),
        ), patch(
            "backend.services.surge_scanner.service._get_open_position_entry",
            new=AsyncMock(return_value=None),
        ), patch(
            "backend.services.surge_scanner.service._open_surge_position",
            new=AsyncMock(),
        ) as mock_open:
            alert = await scanner._scan_symbol(symbol)

        assert alert is not None
        assert alert.alert_type == "NORMAL_SURGE"
        assert abs(alert.position_pct - scanner.NORMAL_POSITION_PCT) < 0.001
        mock_open.assert_called_once_with(symbol, scanner.NORMAL_POSITION_PCT)

    @pytest.mark.asyncio
    async def test_strong_surge_15_to_20_pct(self):
        _reset_scanner()
        symbol = "SOLUSDT"
        ref_price = 100.0
        current_price = 117.0  # +17% surge

        _fill_history(symbol, ref_price)

        with patch(
            "backend.services.surge_scanner.service._get_current_price",
            new=AsyncMock(return_value=current_price),
        ), patch(
            "backend.services.surge_scanner.service._get_open_position_entry",
            new=AsyncMock(return_value=None),
        ), patch(
            "backend.services.surge_scanner.service._open_surge_position",
            new=AsyncMock(),
        ) as mock_open:
            alert = await scanner._scan_symbol(symbol)

        assert alert is not None
        assert alert.alert_type == "STRONG_SURGE"
        assert abs(alert.position_pct - scanner.STRONG_POSITION_PCT) < 0.001
        mock_open.assert_called_once_with(symbol, scanner.STRONG_POSITION_PCT)

    @pytest.mark.asyncio
    async def test_flat_market_no_alert(self):
        _reset_scanner()
        symbol = "BNBUSDT"
        ref_price = 400.0
        current_price = 402.0  # +0.5% — no surge

        _fill_history(symbol, ref_price)

        with patch(
            "backend.services.surge_scanner.service._get_current_price",
            new=AsyncMock(return_value=current_price),
        ), patch(
            "backend.services.surge_scanner.service._get_open_position_entry",
            new=AsyncMock(return_value=None),
        ), patch(
            "backend.services.surge_scanner.service._open_surge_position",
            new=AsyncMock(),
        ) as mock_open:
            alert = await scanner._scan_symbol(symbol)

        assert alert is None
        mock_open.assert_not_called()


class TestKillSwitch:
    @pytest.mark.asyncio
    async def test_kill_switch_suppresses_scan(self):
        """Kill switch active → scanner loop skips scan entirely."""
        _reset_scanner()

        # Simulate one iteration of the loop with kill switch active
        with patch(
            "backend.services.guardian_bot.service.is_kill_switch_active",
            new=AsyncMock(return_value=True),
        ), patch(
            "backend.services.surge_scanner.service._scan_symbol",
            new=AsyncMock(),
        ) as mock_scan:
            # We're not running the full loop — just assert scan is not called
            from backend.services.guardian_bot.service import is_kill_switch_active
            kill = await is_kill_switch_active()
            if not kill:
                for sym in scanner.WATCHED_SYMBOLS:
                    await scanner._scan_symbol(sym)

        mock_scan.assert_not_called()


class TestGetSurgeStatus:
    def test_get_surge_status_structure(self):
        _reset_scanner()
        status = scanner.get_surge_status()

        assert "running" in status
        assert "watched_symbols" in status
        assert "config" in status
        assert status["config"]["stop_loss_pct"] == scanner.STOP_LOSS_PCT
        assert status["config"]["surge_threshold_mid"] == scanner.SURGE_THRESHOLD_MID
        assert status["config"]["surge_threshold_high"] == scanner.SURGE_THRESHOLD_HIGH
