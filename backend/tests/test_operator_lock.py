from __future__ import annotations

from types import SimpleNamespace

from backend.security.operator_lock import install_fail_closed_operator_key


def test_configured_operator_key_is_installed_without_exposure():
    app_module = SimpleNamespace(BACKEND_API_KEY=None)
    context_module = SimpleNamespace(BACKEND_API_KEY=None)

    state = install_fail_closed_operator_key(
        app_module,
        context_module,
        env={"BACKEND_API_KEY": "configured-secret"},
        token_factory=lambda _: "unused-generated-value",
    )

    assert state.configured is True
    assert state.locked is False
    assert app_module.BACKEND_API_KEY == "configured-secret"
    assert context_module.BACKEND_API_KEY == "configured-secret"


def test_missing_operator_key_installs_process_local_deny_all_lock():
    app_module = SimpleNamespace(BACKEND_API_KEY=None)
    context_module = SimpleNamespace(BACKEND_API_KEY=None)

    state = install_fail_closed_operator_key(
        app_module,
        context_module,
        env={},
        token_factory=lambda _: "unpublished-random-lock",
    )

    assert state.configured is False
    assert state.locked is True
    assert app_module.BACKEND_API_KEY == "unpublished-random-lock"
    assert context_module.BACKEND_API_KEY == "unpublished-random-lock"


def test_blank_operator_key_is_treated_as_missing():
    app_module = SimpleNamespace(BACKEND_API_KEY=None)
    context_module = SimpleNamespace(BACKEND_API_KEY=None)

    state = install_fail_closed_operator_key(
        app_module,
        context_module,
        env={"BACKEND_API_KEY": "   "},
        token_factory=lambda _: "locked",
    )

    assert state.locked is True
    assert app_module.BACKEND_API_KEY == "locked"
