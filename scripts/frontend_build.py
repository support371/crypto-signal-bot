#!/usr/bin/env python3
"""
Canonical frontend production build helper.

Uses local Node when it matches the repo contract, otherwise falls back to the
Node 22 Docker build stage so release verification stays clean on older hosts.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
REQUIRED_NODE = (22, 12, 0)


def parse_node_version(raw: str) -> tuple[int, int, int] | None:
    text = raw.strip().lstrip("v")
    parts = text.split(".")
    if len(parts) != 3:
        return None
    try:
        return tuple(int(part) for part in parts)  # type: ignore[return-value]
    except ValueError:
        return None


def resolve_command(name: str) -> str | None:
    direct = shutil.which(name)
    if direct is not None:
        return direct

    if os.name == "nt":
        for candidate in (f"{name}.cmd", f"{name}.exe", f"{name}.bat"):
            resolved = shutil.which(candidate)
            if resolved is not None:
                return resolved

    return None


def local_node_is_compatible() -> bool:
    node = resolve_command("node")
    npm = resolve_command("npm")
    if node is None or npm is None:
        return False

    result = subprocess.run(
        [node, "-v"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    version = parse_node_version(result.stdout)
    return version is not None and version >= REQUIRED_NODE


def local_node_version() -> tuple[int, int, int] | None:
    node = resolve_command("node")
    if node is None:
        return None

    result = subprocess.run(
        [node, "-v"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return parse_node_version(result.stdout)


def run(cmd: list[str], *, env: dict[str, str]) -> None:
    executable = resolve_command(cmd[0])
    if executable is not None:
      cmd = [executable, *cmd[1:]]
    subprocess.run(cmd, cwd=REPO_ROOT, env=env, check=True)


def main() -> int:
    env = os.environ.copy()
    env.setdefault("VITE_BACKEND_URL", "/api")
    env.setdefault("VITE_API_BASE_URL", "/api")

    if local_node_is_compatible():
        print("[OK] Using local Node toolchain for frontend build.")
        run(["npm", "run", "build"], env=env)
        return 0

    if resolve_command("npm") is not None:
        version = local_node_version()
        if version is not None:
            print(
                "[WARN] Local Node is below the documented 22.12.0 baseline "
                f"(found {version[0]}.{version[1]}.{version[2]}). Trying local build first."
            )
        else:
            print("[WARN] Unable to determine local Node version. Trying local build first.")

        try:
            run(["npm", "run", "build"], env=env)
            print("[OK] Local frontend build succeeded without Docker.")
            return 0
        except subprocess.CalledProcessError:
            print("[WARN] Local frontend build failed. Falling back to Docker if available.")

    docker = resolve_command("docker")
    if docker is None:
        print("[FAIL] Local Node is below 22.12.0 and Docker is unavailable.")
        print("       Install Node 22.12.0+ or run the build on a host with Docker.")
        return 1

    print("[OK] Local Node is below 22.12.0; using Docker Node 22 build stage.")
    run(
        [
            docker,
            "build",
            "--target",
            "build",
            "-f",
            "Dockerfile.frontend",
            "--build-arg",
            f"VITE_BACKEND_URL={env['VITE_BACKEND_URL']}",
            "--build-arg",
            f"VITE_API_BASE_URL={env['VITE_API_BASE_URL']}",
            "--build-arg",
            f"VITE_SUPABASE_URL={env.get('VITE_SUPABASE_URL', '')}",
            "--build-arg",
            f"VITE_SUPABASE_PUBLISHABLE_KEY={env.get('VITE_SUPABASE_PUBLISHABLE_KEY', '')}",
            ".",
        ],
        env=env,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"[FAIL] Command exited with status {exc.returncode}: {' '.join(exc.cmd)}")
        sys.exit(exc.returncode)
