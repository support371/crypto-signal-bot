from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Check:
    name: str
    command: list[str]
    required: bool = True


def run_check(check: Check) -> bool:
    if not check.command:
        return True

    executable = check.command[0]
    if shutil.which(executable) is None:
        status = "missing required tool" if check.required else "skipped optional tool"
        print(f"\n[{check.name}] {status}: {executable}")
        return not check.required

    print(f"\n[{check.name}] $ {' '.join(check.command)}")
    completed = subprocess.run(check.command, cwd=ROOT)
    if completed.returncode == 0:
        print(f"[{check.name}] ok")
        return True

    print(f"[{check.name}] failed with exit code {completed.returncode}")
    return not check.required


def main() -> int:
    python = sys.executable
    checks = [
        Check("frontend build", ["npm", "run", "build"]),
        Check("frontend test", ["npm", "test", "--", "--run"], required=False),
        Check("backend focused tests", [python, "-m", "pytest", "backend/tests/test_event_log_store.py", "backend/tests/test_audit_store_event_log.py", "backend/tests/test_event_log_router.py", "-q"], required=False),
        Check("repo audit", [python, "scripts/repo_audit.py"]),
        Check("security hygiene audit", [python, "scripts/security_hygiene_audit.py"]),
        Check("event log check", [python, "scripts/event_log_check.py"]),
    ]

    failures = [check.name for check in checks if not run_check(check)]
    if failures:
        print("\nRelease check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("\nRelease check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
