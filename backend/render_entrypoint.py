"""Render-specific ASGI entrypoint for the paper-only deployment boundary.

This module imports the canonical FastAPI application, installs fail-closed
operator authentication for every protected write route, restricts hosted CORS
to explicit origins, and replaces public health/readiness routes with truthful
non-secret diagnostics.
"""

from __future__ import annotations

import os
import time
from typing import Iterable

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import backend.app as backend_app_module
import backend.logic.context as runtime_context
from backend.app import app
from backend.security.operator_lock import install_fail_closed_operator_key

_STARTED_AT = time.time()
_DEFAULT_FRONTEND_ORIGIN = "https://crypto-signal-bot-indol.vercel.app"
_TRUE = {"1", "true", "yes", "on"}


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in _TRUE


def _remove_route(path: str, methods: Iterable[str]) -> None:
    requested_methods = {method.upper() for method in methods}
    retained_routes = []
    for route in app.router.routes:
        route_path = getattr(route, "path", None)
        route_methods = {
            method.upper()
            for method in (getattr(route, "methods", None) or [])
        }
        if route_path == path and route_methods.intersection(requested_methods):
            continue
        retained_routes.append(route)
    app.router.routes = retained_routes


def _normalize_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ALLOWED_ORIGINS",
        os.getenv("CORS_ORIGINS", _DEFAULT_FRONTEND_ORIGIN),
    )
    origins: list[str] = []
    for item in raw.split(","):
        origin = item.strip().rstrip("/")
        if not origin or "*" in origin:
            continue
        if origin not in origins:
            origins.append(origin)
    if not origins:
        origins.append(_DEFAULT_FRONTEND_ORIGIN)
    return origins


def _replace_cors_middleware() -> None:
    origins = _normalize_origins()
    app.user_middleware = [
        middleware
        for middleware in app.user_middleware
        if getattr(middleware, "cls", None) is not CORSMiddleware
    ]
    app.middleware_stack = None
    backend_app_module.ALLOWED_ORIGINS = origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "HEAD", "OPTIONS", "POST"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "X-API-Key",
            "Idempotency-Key",
        ],
        max_age=600,
    )


def _deployment_checks() -> dict[str, bool]:
    mode = str(
        getattr(backend_app_module, "TRADING_MODE", "paper")
    ).strip().lower()
    network = str(
        getattr(backend_app_module, "NETWORK", "testnet")
    ).strip().lower()
    adapter_mode = str(
        getattr(backend_app_module.exchange_adapter, "mode", "unknown")
    ).strip().lower()
    configured_origins = list(
        getattr(backend_app_module, "ALLOWED_ORIGINS", []) or []
    )
    return {
        "paper_mode": mode == "paper",
        "testnet_network": network == "testnet",
        "mainnet_disabled": not _flag("ALLOW_MAINNET"),
        "operator_key_configured": _OPERATOR_LOCK.configured,
        "cors_exact_origins": bool(configured_origins)
        and all("*" not in origin for origin in configured_origins),
        "paper_adapter": adapter_mode == "paper",
    }


def _deployment_blockers(checks: dict[str, bool]) -> list[str]:
    """Return safety blockers for serving the read-only paper application.

    A missing operator key does not make liveness/readiness fail because the
    fail-closed lock keeps all protected mutations inaccessible. It does block
    trading readiness, where an authenticated operator path is required.
    """

    required = (
        "paper_mode",
        "testnet_network",
        "mainnet_disabled",
        "cors_exact_origins",
        "paper_adapter",
    )
    return [name for name in required if not checks.get(name, False)]


# The configured key is installed as-is. When it is absent, a process-local
# random lock value is installed so protected write routes reject every request.
_OPERATOR_LOCK = install_fail_closed_operator_key(
    backend_app_module,
    runtime_context,
    env=os.environ,
)
_replace_cors_middleware()


async def healthz() -> dict:
    return {"status": "ok"}


async def render_health() -> dict:
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render",
        "mode": str(getattr(backend_app_module, "TRADING_MODE", "paper")),
        "network": str(getattr(backend_app_module, "NETWORK", "testnet")),
        "uptime_seconds": round(time.time() - _STARTED_AT, 3),
    }


async def render_ready():
    checks = _deployment_checks()
    failures = _deployment_blockers(checks)
    ready = not failures
    payload = {
        # Keep the existing success value for API compatibility while adding
        # detailed blocking reasons and a correct non-200 response when unsafe.
        "status": "ok" if ready else "degraded",
        "service": "crypto-signal-bot-backend",
        "runtime": "render",
        "mode": str(getattr(backend_app_module, "TRADING_MODE", "paper")),
        "network": str(getattr(backend_app_module, "NETWORK", "testnet")),
        "backend_api_key_configured": _OPERATOR_LOCK.configured,
        "cors_origins_configured": bool(backend_app_module.ALLOWED_ORIGINS),
        "checks": checks,
        "blocking_reasons": failures,
        "operator_routes_locked": _OPERATOR_LOCK.locked,
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
    }
    return JSONResponse(
        status_code=200 if ready else 503,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


async def trading_readiness():
    checks = _deployment_checks()
    failures = _deployment_blockers(checks)
    if not checks["operator_key_configured"]:
        failures.append("operator_key_missing")

    guardian_blocked = bool(
        getattr(runtime_context, "kill_switch_active", False)
        or getattr(runtime_context, "guardian_triggered", False)
    )
    if guardian_blocked:
        failures.append("guardian_or_kill_switch_active")

    paper_ready = not failures
    payload = {
        "status": "ready" if paper_ready else "blocked",
        "paper_ready": paper_ready,
        "live_ready": False,
        "trading_mode": str(
            getattr(backend_app_module, "TRADING_MODE", "paper")
        ),
        "network": str(getattr(backend_app_module, "NETWORK", "testnet")),
        "allow_mainnet": False,
        "live_execution_enabled": False,
        "withdrawals_enabled": False,
        "kill_switch_active": bool(
            getattr(runtime_context, "kill_switch_active", False)
        ),
        "guardian_triggered": bool(
            getattr(runtime_context, "guardian_triggered", False)
        ),
        "checks": checks,
        "blocking_reasons": failures,
    }
    return JSONResponse(
        status_code=200 if paper_ready else 503,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


async def render_root() -> dict:
    return {
        "service": "crypto-signal-bot-backend",
        "status": "ok",
        "health": "/health",
        "readiness": "/ready",
        "trading_readiness": "/trading-readiness",
        "docs": "/docs",
    }


for _path in (
    "/",
    "/health",
    "/healthz",
    "/api/health",
    "/ready",
    "/trading-readiness",
):
    _remove_route(_path, {"GET", "HEAD"})

app.add_api_route(
    "/",
    render_root,
    methods=["GET"],
    tags=["health"],
    summary="Service root",
)
for _path in ("/health", "/api/health"):
    app.add_api_route(
        _path,
        render_health,
        methods=["GET"],
        tags=["health"],
        summary="Hosted runtime liveness",
    )
app.add_api_route(
    "/healthz",
    healthz,
    methods=["GET"],
    tags=["health"],
    summary="Minimal liveness probe",
)
app.add_api_route(
    "/ready",
    render_ready,
    methods=["GET"],
    tags=["health"],
    summary="Hosted deployment readiness",
)
app.add_api_route(
    "/trading-readiness",
    trading_readiness,
    methods=["GET"],
    tags=["health"],
    summary="Paper-mode trading readiness",
)

# Keep the SPA catch-all last so it cannot shadow operational routes.
_spa_route = None
_retained = []
for _route in app.router.routes:
    if getattr(_route, "path", None) == "/{path:path}":
        _spa_route = _route
        continue
    _retained.append(_route)
if _spa_route:
    _retained.append(_spa_route)
    app.router.routes = _retained
