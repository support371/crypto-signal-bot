#!/usr/bin/env python3
"""
Detect whether Docker Compose v2 is available on this host.
"""

from __future__ import annotations

import shutil
import subprocess
import sys


def detect_compose_v2() -> bool:
    docker = shutil.which("docker")
    if docker is None:
        return False

    result = subprocess.run(
        [docker, "compose", "version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def main() -> int:
    if detect_compose_v2():
        print("[OK] Docker Compose v2 is available (`docker compose`).")
        return 0

    print("[BLOCKED] Docker Compose v2 is not installed on this host.")
    print("          Install the Docker Compose plugin to run full-stack container validation.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
