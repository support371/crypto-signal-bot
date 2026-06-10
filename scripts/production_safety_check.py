"""
Production safety guard for Crypto Signal Bot deployments.

This script performs environment sanity checks and exits with a non-zero
status code if a misconfiguration is detected. It is intended to be
invoked as part of CI/CD pipelines or at container startup to prevent
dangerous combinations of environment variables in production.

Checks performed:
1. Demo mode with live trading is blocked.
2. Demo mode with mainnet is blocked.
3. Mainnet live trading requires ALLOW_MAINNET=true.
"""

from __future__ import annotations

import os
import sys


TRUTHY = {"1", "true", "yes", "on"}


def _env_flag(*names: str) -> bool:
    """Return True if any of the given environment variables is truthy."""
    for name in names:
        raw = os.getenv(name)
        if raw is not None and raw.strip() != "":
            return raw.strip().lower() in TRUTHY
    return False


def main() -> None:
    demo_mode = _env_flag("VITE_DEMO_MODE", "DEMO_MODE")
    trading_mode = os.getenv("TRADING_MODE", "paper").strip().lower()
    network = os.getenv("NETWORK", "testnet").strip().lower()
    allow_mainnet = _env_flag("ALLOW_MAINNET")

    errors: list[str] = []

    if demo_mode and trading_mode == "live":
        errors.append(
            "DEMO_MODE is enabled but TRADING_MODE is 'live'. Demo deployments must never execute live trades."
        )

    if demo_mode and network == "mainnet":
        errors.append(
            "DEMO_MODE is enabled but NETWORK is 'mainnet'. Demo deployments must target testnet or synthetic networks."
        )

    if trading_mode == "live" and network == "mainnet" and not allow_mainnet:
        errors.append(
            "TRADING_MODE='live' and NETWORK='mainnet' but ALLOW_MAINNET is not set to true."
        )

    if errors:
        print("FATAL: Production safety check failed:")
        for err in errors:
            print(f" - {err}")
        sys.exit(1)

    print("Production safety check passed — configuration appears safe.")


if __name__ == "__main__":
    main()
