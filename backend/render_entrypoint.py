"""Render-specific ASGI entrypoint.

This module imports the canonical FastAPI app and replaces only public liveness
routes used by hosted deployment platforms. It also normalizes hosted CORS so
Vercel and Base44 frontends can coexist without exposing credentials on broad
origin matches.

The hosted adapter is wrapped with a fail-closed live execution guard. Paper
mode behavior is unchanged; requested live execution cannot silently fall back
to a simulated fill.
"""

from __future__ import annotations

import os
import time
from typing import Iterable

from fastapi.middleware.cors import CORSMiddleware

import backend.app as backend_app_module
from backend.app import app
from backend.logic.live_execution_guard import GuardedExchangeAdapter

_STARTED_AT = time.time()
_BASE44_AND_RENDER_ORIGINS = (
    "https://*.base44.app",
    "https://app.base44.com",
    "https://*.onrender.com",
)
_CORS_WILDCARD_REGEX = (
    r"^https://[A-Za-z0-9-]+\.base44\.app$|"
    r"^https://[A-Za-z0-9-]+\.onrender\.com$"
)


def _remove_route(path: str, methods: Iterable[str]) -> None:
    """Remove existing routes for a path/method pair before adding an override."""
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


def _merged_cors_origins() -> list[str]:
    """Return config/env CORS origins plus required hosted frontend origins."""
    configured = list(
        getattr(backend_app_module, "ALLOWED_ORIGINS", []) or []
    )
    if not configured:
        configured = list(
            backend_app_module.RUNTIME_CONFIG.server.cors_origins
        )

    merged: list[str] = []
    for origin in [*configured, *_BASE44_AND_RENDER_ORIGINS]:
        normalized = origin.strip()
        if normalized and normalized not in merged:
            merged.append(normalized)
    return merged


def _replace_cors_middleware() -> None:
    """Replace app-level CORS with credential-free hosted CORS."""
    cors_origins = _merged_cors_origins()
    exact_origins = [origin for origin in cors_origins if "*" not in origin]

    app.user_middleware = [
        middleware
        for middleware in app.user_middleware
        if getattr(middleware, "cls", None) is not CORSMiddleware
    ]
    app.middleware_stack = None
    backend_app_module.ALLOWED_ORIGINS = cors_origins

    app.add_middleware(
        CORSMiddleware,
        allow_origins=exact_origins,
        allow_origin_regex=_CORS_WILDCARD_REGEX,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _guardian_halted() -> bool:
    return bool(
        getattr(backend_app_module, "kill_switch_active", False)
        or getattr(backend_app_module, "_guardian_triggered", False)
    )


def _wrap_exchange_adapter() -> None:
    current = backend_app_module.exchange_adapter
    if isinstance(current, GuardedExchangeAdapter):
        return

    backend_app_module.exchange_adapter = GuardedExchangeAdapter(
        current,
        trading_mode=backend_app_module.TRADING_MODE,
        network=backend_app_module.NETWORK,
        guardian_halted=_guardian_halted,
        backend_api_key_configured=lambda: bool(
            backend_app_module.BACKEND_API_KEY
        ),
    )


async def healthz() -> dict:
    """Simple health check alias for frontend/lb probes."""
    return {"status": "ok"}


async def render_health() -> dict:
    """Small hosted-runtime liveness response used by deployment health checks."""
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render",
        "mode": os.getenv("TRADING_MODE", "paper"),
        "network": os.getenv("NETWORK", "testnet"),
        "uptime_seconds": round(time.time() - _STARTED_AT, 3),
    }


async def render_ready() -> dict:
    """Confirm critical hosted wiring without exposing secrets."""
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render",
        "backend_api_key_configured": bool(os.getenv("BACKEND_API_KEY")),
        "cors_origins_configured": bool(
            backend_app_module.ALLOWED_ORIGINS
        ),
    }


async def live_readiness() -> dict:
    """Return a sanitized, non-mutating live execution readiness report."""
    adapter = backend_app_module.exchange_adapter
    if not isinstance(adapter, GuardedExchangeAdapter):
        _wrap_exchange_adapter()
        adapter = backend_app_module.exchange_adapter
    return adapter.readiness().to_dict()


async def render_root() -> dict:
    """Root route for manual browser checks and platform probes."""
    return {
        "service": "crypto-signal-bot-backend",
        "status": "ok",
        "health": "/health",
        "live_readiness": "/live/readiness",
        "docs": "/docs",
    }


_wrap_exchange_adapter()
_replace_cors_middleware()

for _path in (
    "/",
    "/health",
    "/healthz",
    "/api/health",
    "/ready",
    "/live/readiness",
):
    _remove_route(_path, {"GET"})

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
        summary="Hosted runtime liveness health check",
    )
app.add_api_route(
    "/healthz",
    healthz,
    methods=["GET"],
    tags=["health"],
    summary="Simple status probe",
)
app.add_api_route(
    "/ready",
    render_ready,
    methods=["GET"],
    tags=["health"],
    summary="Hosted runtime deployment readiness diagnostics",
)
app.add_api_route(
    "/live/readiness",
    live_readiness,
    methods=["GET"],
    tags=["execution"],
    summary="Sanitized live execution readiness",
)

# Ensure SPA fallback does not intercept operational endpoints.
_spa_route = None
_retained = []
for _r in app.router.routes:
    if getattr(_r, "path", None) == "/{path:path}":
        _spa_route = _r
        continue
    _retained.append(_r)
if _spa_route:
    _retained.append(_spa_route)
    app.router.routes = _retained
