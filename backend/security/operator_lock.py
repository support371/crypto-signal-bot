"""Fail-closed operator-key installation for hosted deployments.

The core application historically treated a missing operator key as authentication
being disabled. Hosted production entrypoints must never inherit that behavior:
when no configured key exists, this module installs an unpredictable process-local
lock value so every protected write route remains inaccessible until the operator
provides a real secret through the deployment environment.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Callable, Mapping, MutableMapping, Protocol


class _ModuleLike(Protocol):
    BACKEND_API_KEY: str | None


@dataclass(frozen=True)
class OperatorLockState:
    configured: bool
    locked: bool


def install_fail_closed_operator_key(
    app_module: _ModuleLike,
    context_module: _ModuleLike,
    *,
    env: Mapping[str, str],
    token_factory: Callable[[int], str] = secrets.token_urlsafe,
) -> OperatorLockState:
    """Install the configured key or a process-local deny-all lock value.

    The generated value is intentionally never returned or logged. It only exists
    to make the application's existing dependency reject unauthenticated requests
    instead of treating a missing key as an open configuration.
    """

    configured_key = str(env.get("BACKEND_API_KEY", "")).strip()
    if configured_key:
        effective_key = configured_key
        configured = True
    else:
        effective_key = token_factory(48)
        configured = False

    app_module.BACKEND_API_KEY = effective_key
    context_module.BACKEND_API_KEY = effective_key
    return OperatorLockState(configured=configured, locked=not configured)
