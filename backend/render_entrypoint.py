"""Render-specific ASGI entrypoint.

This module imports the canonical FastAPI app and replaces only the public
liveness route used by Render. The route intentionally avoids exchange,
market-data, database, and mutable kill-switch checks so platform health checks
answer whether the process is alive, not whether downstream services are ready.
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
    """Small Render liveness response used by the deployment health check."""
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render",
        "mode": os.getenv("TRADING_MODE", "paper"),
        "network": os.getenv("NETWORK", "testnet"),
        "uptime_seconds": round(time.time() - _STARTED_AT, 3),
    }


_remove_route("/health", {"GET"})
app.add_api_route(
    "/health",
    render_health,
    methods=["GET"],
    tags=["health"],
    summary="Render liveness health check",
)
