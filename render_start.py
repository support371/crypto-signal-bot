"""Universal Render startup shim — GEM Signal Bot LIVE MODE.

All secrets are injected via Render environment variables — never hardcoded here.
Set the following env vars in your Render service dashboard:
  BITGET_API_KEY, BITGET_API_SECRET, BITGET_API_PASSPHRASE
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
  BACKEND_API_KEY
"""

from __future__ import annotations

import os
import subprocess
import sys

# ── Live Mode Configuration ───────────────────────────────────────────────────
# All credentials and secrets must be set as Render environment variables.
# Do NOT hardcode any API keys, secrets, or tokens in this file.
os.environ.setdefault("EXCHANGE_MODE",           "live")
os.environ.setdefault("TRADING_MODE",            "live")
os.environ.setdefault("EXCHANGE",                "bitget")
os.environ.setdefault("NETWORK",                 "mainnet")
os.environ.setdefault("ALLOW_MAINNET",           "true")

# Capital cap
os.environ.setdefault("LIVE_CAPITAL_CAP_USDT",   "100")
os.environ.setdefault("EXECUTOR_POSITION_PCT",   "0.05")
os.environ.setdefault("EXECUTOR_MAX_POSITIONS",  "4")
os.environ.setdefault("EXECUTOR_MIN_CONFIDENCE", "0.80")
os.environ.setdefault("EXECUTOR_INTERVAL",       "60")

# Guardian limits
os.environ.setdefault("GUARDIAN_MAX_DRAWDOWN_PCT",   "10")
os.environ.setdefault("GUARDIAN_MAX_DAILY_LOSS_PCT", "5")
os.environ.setdefault("GUARDIAN_MAX_API_ERRORS",     "5")
os.environ.setdefault("GUARDIAN_MAX_FAILED_ORDERS",  "3")

# Telegram alerts
os.environ.setdefault("TELEGRAM_ALERTS_ENABLED", "true")

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
