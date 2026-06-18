# backend/services/telegram_alerts.py
"""
Telegram Trade Alert Service — GEM Crypto Bot

Sends real-time trade notifications to @mycybersecureWealthsolution channel
whenever the signal executor opens or closes a position.

Env vars required:
  TELEGRAM_BOT_TOKEN   — @gemassistmedia_bot token
  TELEGRAM_CHANNEL_ID  — -1003368597629
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

log = logging.getLogger(__name__)

_BOT_TOKEN    = os.getenv("TELEGRAM_BOT_TOKEN", "")
_CHANNEL_ID   = os.getenv("TELEGRAM_CHANNEL_ID", "-1003368597629")
_ENABLED      = os.getenv("TELEGRAM_ALERTS_ENABLED", "true").lower() in {"1", "true", "yes"}
_MODE         = os.getenv("TRADING_MODE", "paper").lower()

_TELEGRAM_API = f"https://api.telegram.org/bot{_BOT_TOKEN}/sendMessage"

EMOJI = {
    "BUY":   "🟢",
    "SELL":  "🔴",
    "CLOSE": "⚪",
    "ALERT": "🚨",
    "INFO":  "📊",
    "KILL":  "🛑",
}

COIN_EMOJI = {
    "BTC": "₿",
    "ETH": "Ξ",
    "SOL": "◎",
    "BNB": "🅱",
    "ADA": "₳",
    "XRP": "✕",
    "DOGE": "🐕",
}


def _coin_icon(symbol: str) -> str:
    base = symbol.replace("USDT", "").replace("BUSD", "")
    return COIN_EMOJI.get(base, "🪙")


async def _send(text: str) -> bool:
    if not _ENABLED:
        return False
    try:
        import urllib.request
        import json
        payload = json.dumps({
            "chat_id": _CHANNEL_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(
            _TELEGRAM_API, data=payload,
            headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            result = json.load(resp)
            return result.get("ok", False)
    except Exception as exc:
        log.warning("[telegram_alerts] Send failed: %s", exc)
        return False


def _mode_tag() -> str:
    return "📝 PAPER" if _MODE == "paper" else "💰 LIVE"


async def send_trade_open(
    symbol: str,
    side: str,
    qty: float,
    price: float,
    confidence: float,
    strategy: str,
    equity: float,
) -> None:
    icon = _coin_icon(symbol)
    direction = "🟢 BUY" if side.upper() == "BUY" else "🔴 SELL"
    notional = qty * price
    text = (
        f"<b>{direction} {icon} {symbol}</b>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"📐 Qty: <code>{qty:.6f}</code>\n"
        f"💵 Price: <code>${price:,.2f}</code>\n"
        f"💼 Notional: <code>${notional:,.2f}</code>\n"
        f"🎯 Confidence: <code>{confidence:.1%}</code>\n"
        f"🧠 Strategy: <code>{strategy}</code>\n"
        f"💰 Equity: <code>${equity:,.2f}</code>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"{_mode_tag()} | GEM Signal Bot"
    )
    await _send(text)


async def send_trade_close(
    symbol: str,
    qty: float,
    entry_price: float,
    close_price: float,
    pnl: float,
    equity: float,
) -> None:
    icon = _coin_icon(symbol)
    pnl_icon = "✅" if pnl >= 0 else "❌"
    pnl_pct = ((close_price - entry_price) / entry_price) * 100
    text = (
        f"<b>⚪ CLOSE {icon} {symbol}</b>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"📐 Qty: <code>{qty:.6f}</code>\n"
        f"📥 Entry: <code>${entry_price:,.2f}</code>\n"
        f"📤 Exit: <code>${close_price:,.2f}</code>\n"
        f"{pnl_icon} PnL: <code>${pnl:+,.2f} ({pnl_pct:+.2f}%)</code>\n"
        f"💰 Equity: <code>${equity:,.2f}</code>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"{_mode_tag()} | GEM Signal Bot"
    )
    await _send(text)


async def send_guardian_alert(reason: str, drawdown_pct: float, equity: float) -> None:
    text = (
        f"<b>🛑 GUARDIAN KILL SWITCH ACTIVATED</b>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"⚠️ Reason: <code>{reason}</code>\n"
        f"📉 Drawdown: <code>{drawdown_pct:.2f}%</code>\n"
        f"💰 Equity: <code>${equity:,.2f}</code>\n"
        f"🔒 All trading halted.\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"{_mode_tag()} | GEM Signal Bot"
    )
    await _send(text)


async def send_guardian_reset(new_equity: float) -> None:
    text = (
        f"<b>✅ GUARDIAN RESET — Trading Resumed</b>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"💰 Starting Equity: <code>${new_equity:,.2f}</code>\n"
        f"🔓 Kill switch cleared by operator.\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"{_mode_tag()} | GEM Signal Bot"
    )
    await _send(text)


async def send_mode_switch(old_mode: str, new_mode: str, exchange: str) -> None:
    icon = "💰" if new_mode == "live" else "📝"
    text = (
        f"<b>{icon} TRADING MODE SWITCHED</b>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"📤 From: <code>{old_mode.upper()}</code>\n"
        f"📥 To: <code>{new_mode.upper()}</code>\n"
        f"🏦 Exchange: <code>{exchange.upper()}</code>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"GEM Signal Bot"
    )
    await _send(text)


async def send_daily_summary(
    equity: float,
    starting_equity: float,
    daily_pnl: float,
    trade_count: int,
    win_rate: float,
    drawdown_pct: float,
) -> None:
    pnl_icon = "📈" if daily_pnl >= 0 else "📉"
    pnl_pct = ((equity - starting_equity) / starting_equity) * 100
    text = (
        f"<b>📊 GEM Bot Daily Summary</b>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"💰 Equity: <code>${equity:,.2f}</code>\n"
        f"{pnl_icon} Daily PnL: <code>${daily_pnl:+,.2f} ({pnl_pct:+.2f}%)</code>\n"
        f"📐 Trades: <code>{trade_count}</code>\n"
        f"🎯 Win Rate: <code>{win_rate:.1f}%</code>\n"
        f"📉 Max Drawdown: <code>{drawdown_pct:.2f}%</code>\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"{_mode_tag()} | GEM Signal Bot\n"
        f"<a href='https://t.me/mycybersecureWealthsolution'>Join our channel</a>"
    )
    await _send(text)
