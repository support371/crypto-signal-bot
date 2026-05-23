"""Render-specific ASGI entrypoint.

This module imports the canonical FastAPI app and replaces only public liveness
routes used by hosted deployment platforms. The routes intentionally avoid
exchange, market-data, database, and mutable kill-switch checks so platform
health checks answer whether the process is alive, not whether downstream
services are ready.
"""

from __future__ import annotations

import os
import time
from typing import Iterable

from backend.app import app

_STARTED_AT = time.time()


def _remove_route(path: str, methods: Iterable[str]) -> None:
    """Remove existing routes for a path/method pair before adding an override."""
    requested_methods = {method.upper() for method in methods}
    retained_routes = []
    for route in app.router.routes:
        route_path = getattr(route, "path", None)
        route_methods = {method.upper() for method in (getattr(route, "methods", None) or [])}
        if route_path == path and route_methods.intersection(requested_methods):
            continue
        retained_routes.append(route)
    app.router.routes = retained_routes


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


async def render_root() -> dict:
    """Root route for manual browser checks and platform probes."""
    return {
        "service": "crypto-signal-bot-backend",
        "status": "ok",
        "health": "/health",
        "docs": "/docs",
    }


for _path in ("/", "/health", "/healthz", "/api/health"):
    _remove_route(_path, {"GET"})

app.add_api_route(
    "/",
    render_root,
    methods=["GET"],
    tags=["health"],
    summary="Service root",
)
for _path in ("/health", "/healthz", "/api/health"):
    app.add_api_route(
        _path,
        render_health,
        methods=["GET"],
        tags=["health"],
        summary="Hosted runtime liveness health check",
    )
