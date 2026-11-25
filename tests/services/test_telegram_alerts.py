# tests/services/test_telegram_alerts.py
"""
Tests for the Telegram trade alert service.

Verifies message formatting and send behavior without hitting the Telegram API.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _disable_telegram():
    with patch.dict("os.environ", {"TELEGRAM_ALERTS_ENABLED": "false"}):
        yield


class TestCoinIcon:
    def test_known_coins(self):
        from backend.services.telegram_alerts import _coin_icon
        assert _coin_icon("BTCUSDT") == "₿"
        assert _coin_icon("ETHUSDT") == "Ξ"
        assert _coin_icon("SOLUSDT") == "◎"

    def test_unknown_coin_returns_default(self):
        from backend.services.telegram_alerts import _coin_icon
        assert _coin_icon("RANDOMUSDT") == "🪙"


class TestModeTag:
    def test_paper_mode(self):
        from backend.services import telegram_alerts
        original = telegram_alerts._MODE
        try:
            telegram_alerts._MODE = "paper"
            assert "PAPER" in telegram_alerts._mode_tag()
        finally:
            telegram_alerts._MODE = original

    def test_live_mode(self):
        from backend.services import telegram_alerts
        original = telegram_alerts._MODE
        try:
            telegram_alerts._MODE = "live"
            assert "LIVE" in telegram_alerts._mode_tag()
        finally:
            telegram_alerts._MODE = original


class TestSendDisabled:
    @pytest.mark.asyncio
    async def test_send_returns_false_when_disabled(self):
        from backend.services.telegram_alerts import _send
        result = await _send("test message")
        assert result is False


class TestSendEnabled:
    @pytest.mark.asyncio
    async def test_send_calls_telegram_api(self):
        from backend.services import telegram_alerts
        original_enabled = telegram_alerts._ENABLED
        try:
            telegram_alerts._ENABLED = True
            mock_response = type("Resp", (), {"__enter__": lambda s: s, "__exit__": lambda *a: None, "read": lambda s: b'{"ok": true}'})()
            with patch("urllib.request.urlopen", return_value=mock_response) as mock_urlopen:
                result = await telegram_alerts._send("test")
            assert result is True
            mock_urlopen.assert_called_once()
        finally:
            telegram_alerts._ENABLED = original_enabled

    @pytest.mark.asyncio
    async def test_send_handles_network_error(self):
        from backend.services import telegram_alerts
        original_enabled = telegram_alerts._ENABLED
        try:
            telegram_alerts._ENABLED = True
            with patch("urllib.request.urlopen", side_effect=OSError("Connection refused")):
                result = await telegram_alerts._send("test")
            assert result is False
        finally:
            telegram_alerts._ENABLED = original_enabled


class TestTradeAlertFormatting:
    @pytest.mark.asyncio
    async def test_send_trade_open_does_not_raise(self):
        from backend.services.telegram_alerts import send_trade_open
        await send_trade_open(
            symbol="BTCUSDT", side="BUY", qty=0.001,
            price=50000.0, confidence=0.85, strategy="momentum", equity=10000.0,
        )

    @pytest.mark.asyncio
    async def test_send_trade_close_does_not_raise(self):
        from backend.services.telegram_alerts import send_trade_close
        await send_trade_close(
            symbol="ETHUSDT", qty=0.1,
            entry_price=3000.0, close_price=3100.0, pnl=10.0, equity=10010.0,
        )

    @pytest.mark.asyncio
    async def test_send_guardian_alert_does_not_raise(self):
        from backend.services.telegram_alerts import send_guardian_alert
        await send_guardian_alert(reason="Drawdown exceeded", drawdown_pct=5.5, equity=9450.0)

    @pytest.mark.asyncio
    async def test_send_guardian_reset_does_not_raise(self):
        from backend.services.telegram_alerts import send_guardian_reset
        await send_guardian_reset(new_equity=10000.0)

    @pytest.mark.asyncio
    async def test_send_mode_switch_does_not_raise(self):
        from backend.services.telegram_alerts import send_mode_switch
        await send_mode_switch(old_mode="paper", new_mode="live", exchange="binance")

    @pytest.mark.asyncio
    async def test_send_daily_summary_does_not_raise(self):
        from backend.services.telegram_alerts import send_daily_summary
        await send_daily_summary(
            equity=10500.0, starting_equity=10000.0,
            daily_pnl=500.0, trade_count=12, win_rate=66.7, drawdown_pct=1.2,
        )
