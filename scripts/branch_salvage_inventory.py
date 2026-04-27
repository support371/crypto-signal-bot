from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "manifests" / "branch_salvage"
IGNORE_SUFFIXES = {".pyc", ".pyo", ".zip", ".tar", ".gz", ".log", ".sqlite", ".sqlite3", ".db"}
IGNORE_PARTS = {".git", "node_modules", "dist", "build", "__pycache__", ".pytest_cache", ".venv", "venv"}
SECRET_SUFFIXES = {".env", ".pem", ".key", ".p12", ".pfx"}
TEST_LIKE_SEGMENTS = {"test", "tests", "integration_tests", "integration-tests", "testcases", "test_cases"}
PROMOTABLE_KEYWORDS = {
    "adapter",
    "exchange",
    "risk",
    "guardian",
    "reconcile",
    "reconciliation",
    "signal",
    "feature",
    "execution",
    "order",
    "position",
    "pnl",
    "audit",
    "test",
    "docker",
    "compose",
    "workflow",
    "circleci",
    "config",
    "env",
}


@dataclass(frozen=True)
class BranchFile:
    branch: str
    commit: str
    path: str
    blob_sha: str
    size: int
    extension: str
    classification: str


def run_git(args: list[str]) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()


def list_remote_branches(remote: str) -> list[str]:
    output = run_git(["branch", "-r", "--format=%(refname:short)"])
    branches: list[str] = []
    for line in output.splitlines():
        branch = line.strip()
        if not branch or branch.endswith("/HEAD"):
            continue
        if remote and not branch.startswith(f"{remote}/"):
            continue
        branches.append(branch)
    return sorted(set(branches))


def is_ignored_path(path: str) -> bool:
    parts = Path(path).parts
    return any(part in IGNORE_PARTS for part in parts) or Path(path).suffix.lower() in IGNORE_SUFFIXES


def is_secret_like_path(path: str) -> bool:
    candidate = Path(path)
    name = candidate.name.lower()
    suffix = candidate.suffix.lower()
    return (
        suffix in SECRET_SUFFIXES
        or name == ".env"
        or name.startswith(".env.")
        or any(part.lower() in {"secrets", "secret", "credentials", "credential"} for part in candidate.parts)
    )


def is_test_like_path(path: str) -> bool:
    lowered = path.lower()
    segments = [segment.lower() for segment in Path(path).parts]
    return any(segment in TEST_LIKE_SEGMENTS for segment in segments) or "/test" in lowered or lowered.startswith("test")


def classify_path(path: str) -> str:
    lowered = path.lower()
    suffix = Path(path).suffix.lower()
    if is_ignored_path(path) or is_secret_like_path(path):
        return "DO_NOT_PROMOTE"
    if any(keyword in lowered for keyword in PROMOTABLE_KEYWORDS):
        if is_test_like_path(path) or suffix in {".yml", ".yaml", ".toml"}:
            return "REFERENCE_OR_PORT"
        return "PORT_CANDIDATE"
    if suffix in {".md", ".txt"}:
        return "REFERENCE_ONLY"
    return "REFERENCE_ONLY"


def file_hash(branch: str, path: str) -> tuple[str, int]:
    try:
        raw = subprocess.check_output(["git", "show", f"{branch}:{path}"], cwd=ROOT, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return "", 0
    return hashlib.sha256(raw).hexdigest(), len(raw)


def inspect_branch(branch: str) -> list[BranchFile]:
    commit = run_git(["rev-parse", branch])
    output = run_git(["ls-tree", "-r", "--name-only", branch])
    rows: list[BranchFile] = []
    for path in output.splitlines():
        path = path.strip()
        if not path:
            continue
        blob_sha, size = file_hash(branch, path)
        rows.append(
            BranchFile(
                branch=branch,
                commit=commit,
                path=path,
                blob_sha=blob_sha,
                size=size,
                extension=Path(path).suffix.lower(),
                classification=classify_path(path),
            )
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def display_output_dir(output_dir: Path) -> str:
    try:
        return str(output_dir.resolve().relative_to(ROOT))
    except ValueError:
        return str(output_dir.resolve())


def fetch_refs(remote: str, *, fetch_all: bool = False, prune: bool = False) -> None:
    fetch_args = ["fetch"]
    if fetch_all:
        fetch_args.append("--all")
    else:
        fetch_args.append(remote)
    fetch_args.append("--tags")
    if prune:
        fetch_args.append("--prune")
    run_git(fetch_args)


def build_inventory(remote: str, output_dir: Path, *, fetch_all: bool = False, prune: bool = False) -> int:
    resolved_output_dir = output_dir if output_dir.is_absolute() else ROOT / output_dir
    fetch_refs(remote, fetch_all=fetch_all, prune=prune)
    branches = list_remote_branches(remote)
    all_files: list[BranchFile] = []
    for branch in branches:
        all_files.extend(inspect_branch(branch))

    inventory_rows = [row.__dict__ for row in all_files]
    write_csv(
        resolved_output_dir / "branch_file_inventory.csv",
        inventory_rows,
        ["branch", "commit", "path", "blob_sha", "size", "extension", "classification"],
    )

    path_counts = Counter(row.path for row in all_files)
    duplicate_path_rows = [
        {"path": path, "occurrences": count}
        for path, count in sorted(path_counts.items())
        if count > 1
    ]
    write_csv(resolved_output_dir / "duplicate_paths.csv", duplicate_path_rows, ["path", "occurrences"])

    blob_to_locations: dict[str, list[str]] = defaultdict(list)
    for row in all_files:
        if row.blob_sha:
            blob_to_locations[row.blob_sha].append(f"{row.branch}:{row.path}")
    duplicate_blob_rows = [
        {"blob_sha": blob, "occurrences": len(locations), "locations": " | ".join(locations[:20])}
        for blob, locations in sorted(blob_to_locations.items())
        if len(locations) > 1
    ]
    write_csv(resolved_output_dir / "duplicate_blobs.csv", duplicate_blob_rows, ["blob_sha", "occurrences", "locations"])

    promotable_rows = [
        row.__dict__ for row in all_files if row.classification in {"PORT_CANDIDATE", "REFERENCE_OR_PORT"}
    ]
    write_csv(
        resolved_output_dir / "promotable_candidates.csv",
        promotable_rows,
        ["branch", "commit", "path", "blob_sha", "size", "extension", "classification"],
    )

    summary = {
        "branches_scanned": len(branches),
        "files_scanned": len(all_files),
        "promotable_candidates": len(promotable_rows),
        "duplicate_paths": len(duplicate_path_rows),
        "duplicate_blobs": len(duplicate_blob_rows),
        "output_dir": display_output_dir(resolved_output_dir),
        "fetch_all": fetch_all,
        "prune": prune,
    }
    (resolved_output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory remote branches for salvage candidates without modifying source files.")
    parser.add_argument("--remote", default="origin", help="Remote prefix to scan, default: origin")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for generated CSV/JSON manifests")
    parser.add_argument("--fetch-all", action="store_true", help="Fetch all remotes instead of only the selected remote")
    parser.add_argument("--prune", action="store_true", help="Prune remote-tracking refs during fetch")
    args = parser.parse_args()
    return build_inventory(args.remote, Path(args.output_dir), fetch_all=args.fetch_all, prune=args.prune)


if __name__ == "__main__":
    raise SystemExit(main())
