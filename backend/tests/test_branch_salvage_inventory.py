from scripts.branch_salvage_inventory import classify_path, is_ignored_path


def test_classify_exchange_adapter_as_port_candidate():
    assert classify_path("backend/logic/exchange_adapter.py") == "PORT_CANDIDATE"


def test_classify_tests_as_reference_or_port():
    assert classify_path("backend/tests/test_live_mode.py") == "REFERENCE_OR_PORT"


def test_classify_archives_as_do_not_promote():
    assert classify_path("old-builds/final-push.zip") == "DO_NOT_PROMOTE"


def test_ignored_path_uses_relative_parts():
    assert is_ignored_path("src/components/build/Generated.tsx")
    assert not is_ignored_path("backend/logic/risk.py")
