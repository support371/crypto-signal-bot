"""Render startup shim for the paper-only production-readiness deployment.

The startup process intentionally forces simulated trading and testnet-safe
configuration unless the hosting environment already provides stricter values.
Real-money execution is not enabled by this entrypoint.
"""

from __future__ import annotations

import os
import subprocess
import sys


# Fail-safe deployment defaults. These are intentionally non-destructive and
# preserve the paper ledger while the production-readiness audit is in progress.
os.environ.setdefault("EXCHANGE_MODE", "paper")
os.environ.setdefault("TRADING_MODE", "paper")
os.environ.setdefault("NETWORK", "testnet")
os.environ.setdefault("ALLOW_MAINNET", "false")
os.environ.setdefault("LIVE_EXECUTION_ENABLED", "false")
os.environ.setdefault("LIVE_MAINNET_ENABLED", "false")
os.environ.setdefault("LIVE_TESTNET_ENABLED", "false")
os.environ.setdefault("LIVE_OWNER_APPROVED", "false")
os.environ.setdefault("PAPER_USE_LIVE_MARKET_DATA", "true")
os.environ.setdefault("TELEGRAM_ALERTS_ENABLED", "false")

PORT = os.getenv("PORT", "10000")
TARGET = "backend.render_entrypoint:app"


def main() -> int:
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        TARGET,
        "--host",
        "0.0.0.0",
        "--port",
        PORT,
    ]
    print(
        "[render_start] starting paper-only backend "
        f"target={TARGET} port={PORT}",
        flush=True,
    )
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())
