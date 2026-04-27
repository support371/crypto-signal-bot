import pytest

from scripts.branch_salvage_inventory import classify_path, is_ignored_path


def test_classify_exchange_adapter_as_port_candidate():
    assert classify_path("backend/logic/exchange_adapter.py") == "PORT_CANDIDATE"


def test_classify_tests_as_reference_or_port():
    assert classify_path("backend/tests/test_live_mode.py") == "REFERENCE_OR_PORT"
    assert classify_path("integration_tests/test_exchange_adapter.py") == "REFERENCE_OR_PORT"


def test_classify_archives_as_do_not_promote():
    assert classify_path("old-builds/final-push.zip") == "DO_NOT_PROMOTE"


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.local",
        ".env.production",
        "secrets/.env",
        "config/prod.key",
        "credentials/service.pem",
    ],
)
def test_classify_secret_like_paths_as_do_not_promote(path):
    assert classify_path(path) == "DO_NOT_PROMOTE"


@pytest.mark.parametrize(
    "path",
    [
        ".github/workflows/branch_salvage.yml",
        "config/risk-config.toml",
        "docker-compose.yaml",
    ],
)
def test_classify_config_paths_as_reference_or_port(path):
    assert classify_path(path) == "REFERENCE_OR_PORT"


def test_ignored_path_uses_relative_parts():
    assert is_ignored_path("src/components/build/Generated.tsx")
    assert not is_ignored_path("backend/logic/risk.py")


@pytest.mark.parametrize(
    "path,expected",
    [
        ("logs/system.log", True),
        ("backend/__pycache__/mod.cpython-311.pyc", True),
        ("frontend/node_modules/package/index.js", True),
        ("frontend/src/node_modules_not/path.js", False),
        ("backend/logs_not/file.txt", False),
    ],
)
def test_ignored_path_suffixes_and_nested_dirs(path, expected):
    assert is_ignored_path(path) is expected
