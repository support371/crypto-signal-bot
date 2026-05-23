#!/usr/bin/env python3
"""Retrying Render backend health smoke test.

Usage:
    python scripts/render_health_smoke.py https://crypto-signal-bot-deqd.onrender.com
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://crypto-signal-bot-deqd.onrender.com"


def _health_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/health"):
        return base
    return f"{base}/health"


def _fetch_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "crypto-signal-bot-render-health-smoke/1.0"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {body[:300]}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Health endpoint did not return JSON: {body[:300]}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"Health endpoint returned non-object JSON: {payload!r}")
    return payload


def main() -> int:
    base_url = sys.argv[1] if len(sys.argv) > 1 else os.getenv("RENDER_BACKEND_URL", DEFAULT_BASE_URL)
    health_url = _health_url(base_url)
    attempts = int(os.getenv("RENDER_HEALTH_ATTEMPTS", "12"))
    delay_seconds = float(os.getenv("RENDER_HEALTH_DELAY_SECONDS", "10"))
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            payload = _fetch_json(health_url)
            if payload.get("status") not in {"ok", "healthy", None}:
                raise RuntimeError(f"Unexpected health status payload: {payload!r}")
            print(f"[OK] Render backend health passed: {health_url}")
            print(json.dumps(payload, sort_keys=True))
            return 0
        except (OSError, urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as exc:
            last_error = exc
            print(f"[WAIT] Render health attempt {attempt}/{attempts} failed: {exc}")
            if attempt < attempts:
                time.sleep(delay_seconds)

    print(f"[FAIL] Render backend health did not pass: {health_url}")
    if last_error is not None:
        print(f"Last error: {last_error}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
