from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACKED_JUNK_SUFFIXES = {".zip", ".tar", ".gz", ".log", ".sqlite", ".sqlite3", ".db"}
SECRET_PATH_PATTERNS = (
    re.compile(r"(^|/)\.env(\.|$)"),
    re.compile(r"(^|/)(secret|secrets|credential|credentials)(/|$)", re.I),
    re.compile(r"\.(pem|key|p12|pfx)$", re.I),
)
SECRET_VALUE_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|api[_-]?secret|secret|token|password)\s*=\s*['\"]?[^\s'\"]{16,}"),
    re.compile(r"(?i)(binance|bitget|btcc|supabase).{0,32}(key|secret|token)"),
)
MAX_BYTES_TO_SCAN = 512_000
ALLOWLIST_PATHS = {
    ".env.example",
    ".env.fullstack.example",
    "backend/env/.env.example",
}


def git_ls_files() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    return [Path(item.decode()) for item in output.split(b"\0") if item]


def is_secret_like_path(path: Path) -> bool:
    normalized = path.as_posix()
    if normalized in ALLOWLIST_PATHS:
        return False
    return any(pattern.search(normalized) for pattern in SECRET_PATH_PATTERNS)


def scan_secret_values(path: Path) -> list[str]:
    full_path = ROOT / path
    if not full_path.is_file() or full_path.stat().st_size > MAX_BYTES_TO_SCAN:
        return []
    try:
        text = full_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    findings: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        for pattern in SECRET_VALUE_PATTERNS:
            if pattern.search(stripped):
                findings.append(f"{path}:{line_number}")
                break
    return findings


def main() -> int:
    files = git_ls_files()
    tracked_junk = sorted(str(path) for path in files if path.suffix.lower() in TRACKED_JUNK_SUFFIXES)
    secret_paths = sorted(str(path) for path in files if is_secret_like_path(path))
    secret_value_hits: list[str] = []
    for path in files:
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2"}:
            continue
        if str(path) in ALLOWLIST_PATHS:
            continue
        secret_value_hits.extend(scan_secret_values(path))

    result = {
        "tracked_files_scanned": len(files),
        "tracked_junk_files": tracked_junk,
        "secret_like_paths": secret_paths,
        "secret_value_hits": secret_value_hits,
    }
    print(json.dumps(result, indent=2))

    return 1 if tracked_junk or secret_paths or secret_value_hits else 0


if __name__ == "__main__":
    raise SystemExit(main())
