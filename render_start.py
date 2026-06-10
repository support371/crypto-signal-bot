"""Universal Render startup shim — GEM Signal Bot LIVE MODE.

Injects environment variables for $100 live test before starting the server.
EXCHANGE_MODE=live | Bitget GEM-Bot key | Guardian: 10% max drawdown
"""

from __future__ import annotations

import os
import subprocess
import sys

# ── $100 Live Test Configuration ─────────────────────────────────────────────
os.environ.setdefault("EXCHANGE_MODE",           "live")
os.environ.setdefault("TRADING_MODE",            "live")   # runtime.py reads this
os.environ.setdefault("EXCHANGE",                "bitget")
os.environ.setdefault("NETWORK",                 "mainnet")
os.environ.setdefault("ALLOW_MAINNET",           "true")

# Bitget GEM-Bot key (no IP restriction)
os.environ.setdefault("BITGET_API_KEY",          "bg_4eb5f494e0d96c52c4d021a69232bd4f")
os.environ.setdefault("BITGET_API_SECRET",       "f92b2eee55a07c0f6ab4f46c3c87d7e6d1d2538e7e187cef05c2b67a4c10b11c")
os.environ.setdefault("BITGET_API_PASSPHRASE",   "9542715097")
os.environ.setdefault("BITGET_PASSPHRASE",       "9542715097")   # pydantic field name

# Capital cap — $100 live test
os.environ.setdefault("LIVE_CAPITAL_CAP_USDT",   "100")
os.environ.setdefault("EXECUTOR_POSITION_PCT",   "0.05")
os.environ.setdefault("EXECUTOR_MAX_POSITIONS",  "4")
os.environ.setdefault("EXECUTOR_MIN_CONFIDENCE", "0.80")
os.environ.setdefault("EXECUTOR_INTERVAL",       "60")

# Guardian — tight limits for live test
os.environ.setdefault("GUARDIAN_MAX_DRAWDOWN_PCT",   "10")
os.environ.setdefault("GUARDIAN_MAX_DAILY_LOSS_PCT", "5")
os.environ.setdefault("GUARDIAN_MAX_API_ERRORS",     "5")
os.environ.setdefault("GUARDIAN_MAX_FAILED_ORDERS",  "3")

# Telegram alerts
os.environ.setdefault("TELEGRAM_ALERTS_ENABLED", "true")
os.environ.setdefault("TELEGRAM_CHANNEL_ID",     "-1003368597629")
os.environ.setdefault("TELEGRAM_BOT_TOKEN",      "8327316373:AAEXeisn6svbs6JHtlIWBon7YOQzbu7upq4")

# ── Server startup ────────────────────────────────────────────────────────────
PORT = os.getenv("PORT", "10000")

CANDIDATES = [
    "backend.health_wrapper:app",
    "backend.render_entrypoint:app",
    "backend.app:app",
    "main:app",
    "app:app",
]


def _run(target: str) -> int:
    cmd = [
        sys.executable, "-m", "uvicorn", target,
        "--host", "0.0.0.0", "--port", PORT,
    ]
    print(f"[render_start] attempting startup target: {target}", flush=True)
    return subprocess.call(cmd)


for candidate in CANDIDATES:
    code = _run(candidate)
    if code == 0:
        raise SystemExit(0)
    print(f"[render_start] target failed: {candidate} exit={code}", flush=True)

raise SystemExit(1)
