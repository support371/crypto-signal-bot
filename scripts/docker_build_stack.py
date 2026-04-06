#!/usr/bin/env python3
"""
Build local Docker images used by the compose stack without relying on
`docker compose up --build`.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent


def run(cmd: list[str], *, env: dict[str, str]) -> None:
    subprocess.run(cmd, cwd=REPO_ROOT, env=env, check=True)


def build_backend(docker: str, env: dict[str, str]) -> None:
    run(
        [
            docker,
            "build",
            "-t",
            "crypto-signal-backend:local",
            "-f",
            "Dockerfile",
            ".",
        ],
        env=env,
    )


def build_frontend(docker: str, env: dict[str, str]) -> None:
    run(
        [
            docker,
            "build",
            "-t",
            "crypto-signal-frontend:local",
            "-f",
            "Dockerfile.frontend",
            "--build-arg",
            f"VITE_BACKEND_URL={env.get('VITE_BACKEND_URL', '/api')}",
            "--build-arg",
            f"VITE_API_BASE_URL={env.get('VITE_API_BASE_URL', '/api')}",
            "--build-arg",
            f"VITE_SUPABASE_URL={env.get('VITE_SUPABASE_URL', '')}",
            "--build-arg",
            f"VITE_SUPABASE_PUBLISHABLE_KEY={env.get('VITE_SUPABASE_PUBLISHABLE_KEY', '')}",
            ".",
        ],
        env=env,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build local Docker images for the compose stack")
    parser.add_argument(
        "--target",
        choices=("backend", "frontend", "all"),
        default="all",
    )
    args = parser.parse_args()

    docker = shutil.which("docker")
    if docker is None:
        print("[FAIL] Docker is not installed.")
        return 1

    env = os.environ.copy()

    if args.target in {"backend", "all"}:
        print("[OK] Building backend image: crypto-signal-backend:local")
        build_backend(docker, env)

    if args.target in {"frontend", "all"}:
        print("[OK] Building frontend image: crypto-signal-frontend:local")
        build_frontend(docker, env)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"[FAIL] Command exited with status {exc.returncode}: {' '.join(exc.cmd)}")
        sys.exit(exc.returncode)
