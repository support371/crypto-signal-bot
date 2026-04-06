#!/usr/bin/env python3
"""
Compose-driven end-to-end smoke test for hybrid live-paper mode.

This script:
  1. Detects Docker Compose v2
  2. Prebuilds backend/frontend images with plain docker build
  3. Starts the full stack in detached mode with live-paper env overrides
  3. Runs the public nginx-facing live-paper smoke test
  4. Tears the stack back down
"""

from __future__ import annotations

import os
import subprocess
import sys
import argparse
from pathlib import Path

from compose_preflight import detect_compose_v2


REPO_ROOT = Path(__file__).resolve().parent.parent


def section(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def run(cmd: list[str], *, env: dict[str, str]) -> None:
    subprocess.run(cmd, cwd=REPO_ROOT, env=env, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compose-driven live-paper smoke")
    parser.add_argument(
        "--exchange",
        choices=("binance", "bitget", "btcc"),
        default=os.getenv("MARKET_DATA_PUBLIC_EXCHANGE", os.getenv("EXCHANGE", "binance")).lower(),
        help="Public market-data exchange to validate through compose.",
    )
    args = parser.parse_args()

    if not detect_compose_v2():
        print("[FAIL] Docker Compose v2 is not available.")
        print("       Install the Docker Compose plugin, then re-run.")
        sys.exit(1)
    compose_cmd = ["docker", "compose"]

    env = os.environ.copy()
    env.setdefault("TRADING_MODE", "paper")
    env.setdefault("PAPER_USE_LIVE_MARKET_DATA", "true")
    env.setdefault("NETWORK", "testnet")
    env.setdefault("EXCHANGE", "binance")
    env["MARKET_DATA_PUBLIC_EXCHANGE"] = args.exchange
    env.setdefault("VITE_BACKEND_URL", "/api")
    env.setdefault("VITE_API_BASE_URL", "/api")
    env.setdefault("CORS_ORIGINS", "http://localhost:8080")

    compose_file = "docker-compose.fullstack.yml"
    prebuild_cmd = [sys.executable, "scripts/docker_build_stack.py"]
    up_cmd = [*compose_cmd, "-f", compose_file, "up", "--no-build", "-d"]
    down_cmd = [*compose_cmd, "-f", compose_file, "down"]
    smoke_cmd = [
        sys.executable,
        "scripts/live_paper_smoke.py",
        "--base-url",
        "http://127.0.0.1:8080/api",
        "--timeout",
        "45",
        "--exchange",
        args.exchange,
    ]

    section("1 / Prebuild images")
    print("  Command:", " ".join(prebuild_cmd))

    section("2 / Start full stack")
    print("  Command:", " ".join(up_cmd))

    try:
        run(prebuild_cmd, env=env)
        run(up_cmd, env=env)

        section("3 / Run nginx-facing live-paper smoke")
        print("  Command:", " ".join(smoke_cmd))
        run(smoke_cmd, env=env)
    finally:
        section("4 / Tear down full stack")
        print("  Command:", " ".join(down_cmd))
        subprocess.run(down_cmd, cwd=REPO_ROOT, env=env, check=False)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"\n[FAIL] Command exited with status {exc.returncode}: {' '.join(exc.cmd)}")
        sys.exit(exc.returncode)
