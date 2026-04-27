from __future__ import annotations

import ast
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
FRONTEND_ROOT_CANDIDATES = [ROOT / "src", ROOT / "frontend" / "app" / "src"]
IGNORE_DIRS = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "venv",
}
JUNK_SUFFIXES = {".pyc", ".pyo", ".log", ".zip", ".tar", ".gz"}
SAFE_DUPLICATE_FILENAMES = {
    ".env.example",
    ".gitignore",
    "package.json",
    "prometheus.yml",
    "audit.py",
    "base.py",
    "metrics.py",
    "pnl.py",
    "index.ts",
    "index.tsx",
}
IMPORT_RE = re.compile(r"import\s+(?:type\s+)?(?:.+?from\s+)?['\"](.+?)['\"]")
ENV_CALL_RE = re.compile(r"_env_(?:str|int|float|bool|csv)\(\s*['\"]([A-Z0-9_]+)['\"]")
ENV_KEY_RE = re.compile(r"^([A-Z0-9_]+)=", re.M)
REQUIRED_BACKEND_COMPOSE_SERVICES = {"backend"}
REQUIRED_FULLSTACK_COMPOSE_SERVICES = {"backend", "frontend"}


def iter_files(root: Path):
    for path in root.rglob("*"):
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.is_file():
            yield path


def frontend_roots() -> list[Path]:
    return [path for path in FRONTEND_ROOT_CANDIDATES if path.exists()]


def build_backend_import_graph() -> dict[str, set[str]]:
    modules: dict[str, Path] = {}
    if not BACKEND_ROOT.exists():
        return {}

    for path in BACKEND_ROOT.rglob("*.py"):
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        module = path.relative_to(ROOT).with_suffix("").as_posix().replace("/", ".")
        if module.endswith(".__init__"):
            module = module[:-9]
        modules[module] = path

    graph: dict[str, set[str]] = {module: set() for module in modules}
    for module, path in modules.items():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        package = module.split(".")
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                base = package[:-node.level] if node.level else []
                mod = node.module or ""
                full = ".".join([*base, mod]).strip(".") if node.level else mod
                if full.startswith("backend") and full in graph:
                    graph[module].add(full)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("backend") and alias.name in graph:
                        graph[module].add(alias.name)
    return graph


def detect_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    state: dict[str, int] = defaultdict(int)
    stack: list[str] = []
    cycles: list[list[str]] = []

    def visit(node: str) -> None:
        state[node] = 1
        stack.append(node)
        for nxt in graph[node]:
            if state[nxt] == 0:
                visit(nxt)
            elif state[nxt] == 1:
                start = stack.index(nxt)
                cycles.append(stack[start:] + [nxt])
        stack.pop()
        state[node] = 2

    for node in graph:
        if state[node] == 0:
            visit(node)
    return cycles


def _resolve_frontend_import(path: Path, target: str) -> bool:
    base = path.parent / target
    candidates = [
        base,
        base.with_suffix(".ts"),
        base.with_suffix(".tsx"),
        base.with_suffix(".js"),
        base.with_suffix(".jsx"),
        base / "index.ts",
        base / "index.tsx",
        base / "index.js",
        base / "index.jsx",
    ]
    return any(candidate.exists() for candidate in candidates)


def check_frontend_relative_imports() -> list[str]:
    problems: list[str] = []
    for root in frontend_roots():
        for path in list(root.rglob("*.ts")) + list(root.rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")
            for target in IMPORT_RE.findall(text):
                if target.startswith("@/"):
                    aliased = root / target[2:]
                    if not _resolve_frontend_import(aliased.parent / "_alias_origin.ts", "./" + aliased.name):
                        problems.append(f"{path.relative_to(ROOT)} -> {target}")
                    continue
                if target.startswith(".") and not _resolve_frontend_import(path, target):
                    problems.append(f"{path.relative_to(ROOT)} -> {target}")
    return problems


def _load_env_example_keys() -> set[str]:
    keys: set[str] = set()
    for env_file in [ROOT / ".env.example", ROOT / "backend" / "env" / ".env.example"]:
        if env_file.exists():
            keys.update(ENV_KEY_RE.findall(env_file.read_text(encoding="utf-8")))
    return keys


def _check_runtime_env_contract() -> list[str]:
    runtime_file = ROOT / "backend" / "config" / "runtime.py"
    if not runtime_file.exists():
        return []
    required_keys = set(ENV_CALL_RE.findall(runtime_file.read_text(encoding="utf-8")))
    documented_keys = _load_env_example_keys()
    missing = sorted(required_keys - documented_keys)
    if missing:
        return ["missing env example keys: " + ", ".join(missing)]
    return []


def _check_compose_contract() -> list[str]:
    problems: list[str] = []
    compose = ROOT / "docker-compose.yml"
    if compose.exists():
        text = compose.read_text(encoding="utf-8")
        for service in sorted(REQUIRED_BACKEND_COMPOSE_SERVICES):
            if f"  {service}:" not in text:
                problems.append(f"missing docker-compose service: {service}")
    fullstack = ROOT / "docker-compose.fullstack.yml"
    if fullstack.exists():
        text = fullstack.read_text(encoding="utf-8")
        for service in sorted(REQUIRED_FULLSTACK_COMPOSE_SERVICES):
            if f"  {service}:" not in text:
                problems.append(f"missing fullstack compose service: {service}")
    return problems


def check_env_consistency() -> list[str]:
    return [*_check_runtime_env_contract(), *_check_compose_contract()]


def main() -> int:
    files = list(iter_files(ROOT))
    junk = [str(path.relative_to(ROOT)) for path in files if path.suffix in JUNK_SUFFIXES]
    filename_counts = Counter(path.name for path in files)
    duplicate_names = {
        name: count
        for name, count in filename_counts.items()
        if count > 1
        and name not in {"__init__.py"}
        and name not in SAFE_DUPLICATE_FILENAMES
    }
    graph = build_backend_import_graph()
    cycles = detect_cycles(graph)
    frontend_import_problems = check_frontend_relative_imports()
    env_problems = check_env_consistency()

    print("# Repo Audit")
    print(f"files_scanned: {len(files)}")
    print(f"frontend_roots: {', '.join(str(path.relative_to(ROOT)) for path in frontend_roots()) or 'none'}")
    print(f"junk_files: {len(junk)}")
    for item in junk[:20]:
        print(f"  - {item}")
    print(f"informational_duplicate_filenames: {len(duplicate_names)}")
    for name, count in sorted(duplicate_names.items()):
        print(f"  - {name}: {count}")
    print(f"backend_import_cycles: {len(cycles)}")
    for cycle in cycles[:10]:
        print("  - " + " -> ".join(cycle))
    print(f"frontend_relative_import_problems: {len(frontend_import_problems)}")
    for problem in frontend_import_problems[:20]:
        print(f"  - {problem}")
    print(f"config_consistency_problems: {len(env_problems)}")
    for problem in env_problems[:20]:
        print(f"  - {problem}")
    return 0 if not junk and not cycles and not frontend_import_problems and not env_problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
