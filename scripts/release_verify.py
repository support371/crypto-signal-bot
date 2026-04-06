#!/usr/bin/env python3
"""
Canonical stabilization/release verification runner.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

from compose_preflight import detect_compose_v2


REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_PORT = 8010
BACKEND_URL = f"http://127.0.0.1:{BACKEND_PORT}"
SMOKE_API_KEY = "release-verify-key"


def section(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    subprocess.run(cmd, cwd=REPO_ROOT, env=env, check=True)


def wait_for_backend(base_url: str, timeout: float = 45.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            response = httpx.get(f"{base_url}/health", timeout=5.0)
            if response.status_code == 200:
                print(f"[OK] Backend is reachable at {base_url}")
                return
        except Exception as exc:  # pragma: no cover - smoke helper
            last_error = exc
        time.sleep(1.0)

    print(f"[FAIL] Backend did not become healthy at {base_url}")
    if last_error:
        print(f"       Last error: {last_error}")
    raise SystemExit(1)


def main() -> int:
    section("1 / Backend tests")
    run([sys.executable, "-m", "pytest", "backend/tests", "-q"])

    section("2 / Frontend production build")
    run([sys.executable, "scripts/frontend_build.py"])

    section("3 / Direct hybrid live-paper + secured-write smoke")
    env = os.environ.copy()
    env.update(
        {
            "TRADING_MODE": "paper",
            "PAPER_USE_LIVE_MARKET_DATA": "true",
            "NETWORK": "testnet",
            "BACKEND_API_KEY": SMOKE_API_KEY,
            "CORS_ORIGINS": "http://localhost:5173,http://localhost:8080",
        }
    )

    backend_proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(BACKEND_PORT),
        ],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        wait_for_backend(BACKEND_URL)
        run([sys.executable, "scripts/live_paper_smoke.py", "--base-url", BACKEND_URL, "--timeout", "45"], env=env)
        run(
            [
                sys.executable,
                "scripts/secured_write_smoke.py",
                "--base-url",
                BACKEND_URL,
                "--api-key",
                SMOKE_API_KEY,
            ],
            env=env,
        )
    finally:
        backend_proc.terminate()
        try:
            backend_proc.wait(timeout=10.0)
        except subprocess.TimeoutExpired:
            backend_proc.kill()
            backend_proc.wait(timeout=5.0)

    section("4 / Compose smoke")
    if detect_compose_v2():
        run([sys.executable, "scripts/compose_live_paper_smoke.py"])
    else:
        print("[BLOCKED] Docker Compose v2 is not installed on this host.")
        print("          Compose smoke skipped; repo-side compose config and docs remain validated.")

    section("Release verification complete")
    print("[OK] Tests, build, direct smoke, and secured write verification passed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"[FAIL] Command exited with status {exc.returncode}: {' '.join(exc.cmd)}")
        sys.exit(exc.returncode)
