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
    re.compile(r"(?i)(api[_-]?key|api[_-]?secret|secret|token|password)\s*=\s*['\"]?([^\s'\"]{16,})"),
    re.compile(r"(?i)(binance|bitget|btcc|supabase).{0,32}(key|secret|token)\s*=\s*['\"]?([^\s'\"]{16,})"),
)
PLACEHOLDER_VALUE_RE = re.compile(
    r"(?i)^(your-|example|placeholder|changeme|change-me|replace-me|todo|dummy|sample|testnet|localhost|https://your-)"
)
MAX_BYTES_TO_SCAN = 512_000
ALLOWLIST_PATHS = {
    ".env.example",
    ".env.fullstack.example",
    "backend/env/.env.example",
}
SKIP_VALUE_SCAN_SUFFIXES = {".md", ".rst"}


def normalized_path(path: Path) -> str:
    return path.as_posix()


def git_ls_files() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    return [Path(item.decode()) for item in output.split(b"\0") if item]


def is_allowlisted_path(path: Path) -> bool:
    return normalized_path(path) in ALLOWLIST_PATHS


def is_secret_like_path(path: Path) -> bool:
    normalized = normalized_path(path)
    if normalized in ALLOWLIST_PATHS:
        return False
    return any(pattern.search(normalized) for pattern in SECRET_PATH_PATTERNS)


def is_placeholder_value(value: str) -> bool:
    normalized = value.strip().strip('"\'')
    return not normalized or bool(PLACEHOLDER_VALUE_RE.search(normalized))


def scan_secret_values(path: Path) -> list[str]:
    if path.suffix.lower() in SKIP_VALUE_SCAN_SUFFIXES:
        return []
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
            match = pattern.search(stripped)
            if match and not is_placeholder_value(match.group(match.lastindex or 0)):
                findings.append(f"{normalized_path(path)}:{line_number}")
                break
    return findings


def main() -> int:
    files = git_ls_files()
    tracked_junk = sorted(normalized_path(path) for path in files if path.suffix.lower() in TRACKED_JUNK_SUFFIXES)
    secret_paths = sorted(normalized_path(path) for path in files if is_secret_like_path(path))
    secret_value_hits: list[str] = []
    for path in files:
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2"}:
            continue
        if is_allowlisted_path(path):
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
