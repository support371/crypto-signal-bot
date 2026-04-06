#!/usr/bin/env python3
"""
Hybrid live-paper smoke test for a running backend instance.

Validates that paper execution stays active while public Binance market data is
flowing through the API and websocket surfaces.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from urllib.parse import urlparse, urlunparse

import httpx
import websockets


def section(title: str) -> None:
    print(f"\n{'-' * 50}")
    print(f"  {title}")
    print(f"{'-' * 50}")


def build_http_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path}"


def build_ws_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    path = parsed.path.rstrip("/")
    if path.endswith("/api"):
        path = path[:-4]
    ws_path = f"{path}/ws/updates" if path else "/ws/updates"
    return urlunparse((scheme, parsed.netloc, ws_path, "", "", ""))


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"  [FAIL] {message}")
        sys.exit(1)
    print(f"  [OK] {message}")


def wait_for_json(
    client: httpx.Client,
    url: str,
    *,
    timeout_seconds: float,
    predicate,
    label: str,
):
    deadline = time.time() + timeout_seconds
    last_payload = None
    while time.time() < deadline:
        response = client.get(url)
        response.raise_for_status()
        payload = response.json()
        last_payload = payload
        if predicate(payload):
            print(f"  [OK] {label}")
            return payload
        time.sleep(1.0)

    print(f"  [FAIL] {label}")
    if last_payload is not None:
        print(f"         last payload: {last_payload}")
    sys.exit(1)


async def check_websocket(base_url: str, timeout_seconds: float) -> None:
    ws_url = build_ws_url(base_url)
    async with websockets.connect(ws_url, ping_interval=20, ping_timeout=20) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout_seconds)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        import json

        message = json.loads(raw)
        if message.get("type") != "health":
            print(f"  [FAIL] websocket initial message was not health: {message}")
            sys.exit(1)
        if message.get("mode") != "paper":
            print(f"  [FAIL] websocket reported non-paper mode: {message}")
            sys.exit(1)
        if message.get("market_data_mode") != "live_public_paper":
            print(f"  [FAIL] websocket did not report live-paper mode: {message}")
            sys.exit(1)
        print("  [OK] websocket health snapshot reports live_public_paper")


def run_smoke(base_url: str, timeout_seconds: float) -> None:
    with httpx.Client(timeout=10.0) as client:
        section("1 / Health and config")
        health = wait_for_json(
            client,
            build_http_url(base_url, "/health"),
            timeout_seconds=timeout_seconds,
            label="/health reports paper mode with live public market data",
            predicate=lambda payload: payload.get("mode") == "paper"
            and payload.get("market_data_mode") == "live_public_paper",
        )
        require(health.get("adapter") == "paper", "execution adapter remains paper")

        config = client.get(build_http_url(base_url, "/config"))
        config.raise_for_status()
        config_payload = config.json()
        require(
            config_payload.get("paper_use_live_market_data") is True,
            "/config enables PAPER_USE_LIVE_MARKET_DATA",
        )

        section("2 / Exchange status")
        exchange_status = wait_for_json(
            client,
            build_http_url(base_url, "/exchange/status"),
            timeout_seconds=timeout_seconds,
            label="/exchange/status reports connected live-paper feed",
            predicate=lambda payload: payload.get("trading_mode") == "paper"
            and payload.get("execution_mode") == "paper"
            and payload.get("market_data_mode") == "live_public_paper"
            and payload.get("connected") is True
            and payload.get("source") in {"binance-public", "binance-rest"},
        )
        require(
            exchange_status.get("connection_state") in {"streaming", "polling"},
            "market-data connection is active",
        )

        section("3 / Market endpoints")
        price = wait_for_json(
            client,
            build_http_url(base_url, "/price?symbol=BTCUSDT"),
            timeout_seconds=timeout_seconds,
            label="/price returns live market data",
            predicate=lambda payload: payload.get("market_data_mode") == "live_public_paper"
            and payload.get("source") in {"binance-public", "binance-rest"}
            and float(payload.get("price", 0.0)) > 0.0,
        )
        require(price.get("source") != "synthetic", "/price is not using synthetic fallback")

        signal = wait_for_json(
            client,
            build_http_url(base_url, "/signal/latest"),
            timeout_seconds=timeout_seconds,
            label="/signal/latest is populated from live-paper startup feed",
            predicate=lambda payload: payload.get("available") is True,
        )
        require(
            signal.get("backend", {}).get("marketDataSource") in {"binance-public", "binance-rest"},
            "/signal/latest tracks live market source",
        )

        guardian = client.get(build_http_url(base_url, "/guardian/status"))
        guardian.raise_for_status()
        guardian_payload = guardian.json()
        require(
            guardian_payload.get("market_data", {}).get("market_data_mode") == "live_public_paper",
            "/guardian/status includes live-paper market data state",
        )

    section("4 / WebSocket")
    asyncio.run(check_websocket(base_url, timeout_seconds=timeout_seconds))

    section("Smoke test complete")
    print("  Hybrid live-paper mode is operational.\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Hybrid live-paper backend smoke test")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="Backend base URL. Use http://localhost:8080/api when testing through nginx.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=25.0,
        help="Seconds to wait for the live-paper feed to come online.",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("  Crypto Signal Bot — Live-Paper Smoke Test")
    print("=" * 50)
    print(f"  Target: {args.base_url}")

    try:
        run_smoke(args.base_url, timeout_seconds=args.timeout)
    except httpx.HTTPError as exc:
        print(f"\n[FAIL] HTTP error: {exc}")
        sys.exit(1)
    except OSError as exc:
        print(f"\n[FAIL] Connection error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
