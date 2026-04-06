#!/usr/bin/env python3
"""
Smoke-test mutating endpoints with BACKEND_API_KEY enabled.
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


def verify_route(
    client: httpx.Client,
    path: str,
    payload: dict,
    api_key: str,
    *,
    expect_success_status: int = 200,
) -> None:
    unauthorized = client.post(path, json=payload)
    require(unauthorized.status_code == 401, f"{path} rejects missing API key")

    authorized = client.post(path, json=payload, headers={"X-API-Key": api_key})
    require(authorized.status_code == expect_success_status, f"{path} accepts valid API key")


def main() -> int:
    parser = argparse.ArgumentParser(description="Secured write endpoint smoke test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", required=True)
    args = parser.parse_args()

    with httpx.Client(base_url=args.base_url, timeout=10.0) as client:
        verify_route(
            client,
            "/market-state",
            {
                "symbol": "BTCUSDT",
                "price": 43000.0,
                "change24h": 1.2,
                "volume24h": 1e9,
                "marketCap": 8e11,
            },
            args.api_key,
        )
        verify_route(
            client,
            "/intent/paper",
            {
                "symbol": "BTCUSDT",
                "side": "BUY",
                "order_type": "MARKET",
                "quantity": 0.0001,
            },
            args.api_key,
        )
        verify_route(
            client,
            "/intent/live",
            {
                "symbol": "BTCUSDT",
                "side": "BUY",
                "order_type": "MARKET",
                "quantity": 0.0001,
            },
            args.api_key,
        )
        verify_route(
            client,
            "/withdraw",
            {
                "asset": "USDT",
                "amount": 5.0,
                "address": "release-smoke-vault",
            },
            args.api_key,
        )

        verify_route(client, "/earnings/reset", {}, args.api_key)
        verify_route(
            client,
            "/kill-switch",
            {"activate": True, "reason": "release smoke"},
            args.api_key,
        )
        authorized = client.post(
            "/kill-switch",
            json={"activate": False},
            headers={"X-API-Key": args.api_key},
        )
        require(authorized.status_code == 200, "/kill-switch deactivation accepts valid API key")

    print("[OK] Secured write endpoints are operational.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
