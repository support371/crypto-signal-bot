"""Universal Render startup shim.

This file exists specifically to make Render auto-detect the backend entrypoint
even if the service loses its configured start command. Prefer the lightweight
health wrapper so hosted liveness/readiness probes are handled before the full
FastAPI router stack sees them.
"""

from __future__ import annotations

import os
import subprocess
import sys

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
        sys.executable,
        "-m",
        "uvicorn",
        target,
        "--host",
        "0.0.0.0",
        "--port",
        PORT,
    ]
    print(f"[render_start] attempting startup target: {target}", flush=True)
    return subprocess.call(cmd)


for candidate in CANDIDATES:
    code = _run(candidate)
    if code == 0:
        raise SystemExit(0)
    print(f"[render_start] target failed: {candidate} exit={code}", flush=True)

raise SystemExit(1)
