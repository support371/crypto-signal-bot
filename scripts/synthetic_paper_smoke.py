#!/usr/bin/env python3
"""
Synthetic paper smoke test for a running backend instance.

Validates that paper execution and synthetic pricing remain active when
PAPER_USE_LIVE_MARKET_DATA=false.
"""

from __future__ import annotations

import argparse
import sys

import httpx


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"[FAIL] {message}")
        sys.exit(1)
    print(f"[OK] {message}")


def url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


def run_smoke(base_url: str) -> None:
    with httpx.Client(timeout=10.0) as client:
        health = client.get(url(base_url, "/health"))
        health.raise_for_status()
        health_payload = health.json()
        require(health_payload.get("mode") == "paper", "/health reports paper mode")
        require(
            health_payload.get("market_data_mode") == "synthetic_paper",
            "/health reports synthetic paper market data",
        )

        config = client.get(url(base_url, "/config"))
        config.raise_for_status()
        config_payload = config.json()
        require(
            config_payload.get("paper_use_live_market_data") is False,
            "/config disables PAPER_USE_LIVE_MARKET_DATA",
        )

        exchange_status = client.get(url(base_url, "/exchange/status"))
        exchange_status.raise_for_status()
        status_payload = exchange_status.json()
        require(status_payload.get("execution_mode") == "paper", "/exchange/status keeps paper execution")
        require(
            status_payload.get("market_data_mode") == "synthetic_paper",
            "/exchange/status reports synthetic market data mode",
        )
        require(status_payload.get("source") == "synthetic", "/exchange/status source stays synthetic")

        price = client.get(url(base_url, "/price?symbol=BTCUSDT"))
        price.raise_for_status()
        price_payload = price.json()
        require(price_payload.get("source") == "synthetic", "/price uses synthetic pricing")
        require(price_payload.get("exchange") is None, "/price does not report a live public exchange")

        signal = client.get(url(base_url, "/signal/latest"))
        signal.raise_for_status()
        signal_payload = signal.json()
        require(signal_payload.get("available") is False, "/signal/latest remains empty until backend market-state input")

    print("\nSynthetic paper mode is operational.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Synthetic paper backend smoke test")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="Backend base URL. Use http://localhost:8080/api when testing through nginx.",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("  Crypto Signal Bot — Synthetic Paper Smoke Test")
    print("=" * 50)
    print(f"  Target: {args.base_url}")

    try:
        run_smoke(args.base_url)
    except httpx.HTTPError as exc:
        print(f"\n[FAIL] HTTP error: {exc}")
        sys.exit(1)
    except OSError as exc:
        print(f"\n[FAIL] Connection error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
