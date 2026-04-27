from __future__ import annotations

import ast
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / 'backend'
FRONTEND_ROOT = ROOT / 'frontend' / 'app' / 'src'
IGNORE_DIRS = {'.git', '.pytest_cache', '__pycache__', 'node_modules', 'dist', 'build', '.venv', 'venv'}
JUNK_SUFFIXES = {'.pyc', '.pyo', '.log', '.zip', '.tar', '.gz'}
SAFE_DUPLICATE_FILENAMES = {'.env.example', '.gitignore', 'package.json', 'prometheus.yml', 'audit.py', 'base.py', 'metrics.py', 'pnl.py'}
IMPORT_RE = re.compile(r"import\s+(?:type\s+)?(?:.+?from\s+)?['\"](.+?)['\"]")
ENV_FIELD_RE = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*:")
ENV_KEY_RE = re.compile(r"^([A-Z0-9_]+)=", re.M)


def iter_files(root: Path):
    for path in root.rglob('*'):
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.is_file():
            yield path


def build_backend_import_graph() -> dict[str, set[str]]:
    modules: dict[str, Path] = {}
    for path in BACKEND_ROOT.rglob('*.py'):
        module = path.relative_to(ROOT).with_suffix('').as_posix().replace('/', '.')
        if module.endswith('.__init__'):
            module = module[:-9]
        modules[module] = path

    graph: dict[str, set[str]] = {module: set() for module in modules}
    for module, path in modules.items():
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        package = module.split('.')
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                base = package[:-node.level] if node.level else []
                mod = node.module or ''
                full = '.'.join([*base, mod]).strip('.') if node.level else mod
                if full.startswith('backend') and full in graph:
                    graph[module].add(full)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith('backend') and alias.name in graph:
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


def check_frontend_relative_imports() -> list[str]:
    problems: list[str] = []
    for path in FRONTEND_ROOT.rglob('*.ts*'):
        text = path.read_text(encoding='utf-8')
        for target in IMPORT_RE.findall(text):
            if not target.startswith('.'):
                continue
            candidates = [
                (path.parent / target).with_suffix('.ts'),
                (path.parent / target).with_suffix('.tsx'),
                path.parent / target / 'index.ts',
                path.parent / target / 'index.tsx',
            ]
            if not any(candidate.exists() for candidate in candidates):
                problems.append(f"{path.relative_to(ROOT)} -> {target}")
    return problems


def check_env_consistency() -> list[str]:
    problems: list[str] = []
    loader = (ROOT / 'backend' / 'app' / 'config' / 'loader.py').read_text(encoding='utf-8')
    env_fields = set(ENV_FIELD_RE.findall(loader))
    env_example_keys = {key.lower() for key in ENV_KEY_RE.findall((ROOT / '.env.example').read_text(encoding='utf-8'))}
    missing = sorted(field for field in env_fields if field not in {'model_config'} and field not in env_example_keys)
    if missing:
        problems.append('missing env keys: ' + ', '.join(missing))
    compose = (ROOT / 'docker-compose.yml').read_text(encoding='utf-8')
    for service in ['api', 'frontend', 'postgres', 'redis', 'prometheus', 'grafana']:
        if f"  {service}:" not in compose:
            problems.append(f'missing compose service: {service}')
    return problems


def main() -> int:
    files = list(iter_files(ROOT))
    junk = [str(path.relative_to(ROOT)) for path in files if path.suffix in JUNK_SUFFIXES]
    filename_counts = Counter(path.name for path in files)
    duplicate_names = {
        name: count for name, count in filename_counts.items()
        if count > 1 and name not in {'__init__.py'} and name not in SAFE_DUPLICATE_FILENAMES
    }
    graph = build_backend_import_graph()
    cycles = detect_cycles(graph)
    frontend_import_problems = check_frontend_relative_imports()
    env_problems = check_env_consistency()

    print('# Repo Audit')
    print(f'files_scanned: {len(files)}')
    print(f'junk_files: {len(junk)}')
    for item in junk[:20]:
        print(f'  - {item}')
    print(f'unexpected_duplicate_filenames: {len(duplicate_names)}')
    for name, count in sorted(duplicate_names.items()):
        print(f'  - {name}: {count}')
    print(f'backend_import_cycles: {len(cycles)}')
    for cycle in cycles[:10]:
        print('  - ' + ' -> '.join(cycle))
    print(f'frontend_relative_import_problems: {len(frontend_import_problems)}')
    for problem in frontend_import_problems[:20]:
        print(f'  - {problem}')
    print(f'config_consistency_problems: {len(env_problems)}')
    for problem in env_problems[:20]:
        print(f'  - {problem}')
    return 0 if not junk and not cycles and not frontend_import_problems and not env_problems and not duplicate_names else 1


if __name__ == '__main__':
    raise SystemExit(main())
