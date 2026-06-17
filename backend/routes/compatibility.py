from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from fastapi import APIRouter

compatibility_router = APIRouter(prefix="/api", tags=["compatibility"])
logger = logging.getLogger("backend.routes.compatibility")
_STARTED_AT = time.time()


def _remove_existing_routes(app, path: str, methods: set[str]) -> None:
    """Remove existing routes matching a path/method pair.

    Render was observed serving the canonical backend root while `/health` could
    still return platform 503s. This helper lets us install a small, dependency-free
    hosted liveness route after the main app has been created, even if the service
    starts `backend.app:app` instead of the Render-specific entrypoint.
    """
    retained = []
    requested_methods = {method.upper() for method in methods}
    for route in app.router.routes:
        route_path = getattr(route, "path", None)
        route_methods = {method.upper() for method in (getattr(route, "methods", None) or [])}
        if route_path == path and route_methods.intersection(requested_methods):
            continue
        retained.append(route)
    app.router.routes = retained


def _install_hosted_health_routes() -> None:
    """Install fail-safe Render health routes on the canonical backend app.

    These routes intentionally avoid market-data, exchange, portfolio, audit, and
    guardian computations. A deployment platform health check should prove the
    ASGI app is alive and bound to `$PORT`; deeper diagnostics remain available via
    `/config`, `/balance`, `/guardian/status`, and dashboard endpoints.
    """
    try:
        from backend import app as backend_app_module

        app = backend_app_module.app
        for path in ("/health", "/healthz", "/api/health"):
            _remove_existing_routes(app, path, {"GET"})

        async def hosted_health() -> dict:
            market_data = backend_app_module._get_market_data_status()
            ctx = backend_app_module.context
            return {
                "status": "ok",
                "service": "crypto-signal-bot-backend",
                "runtime": "render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "asgi",
                "mode": getattr(backend_app_module, "TRADING_MODE", os.getenv("TRADING_MODE", "paper")),
                "network": getattr(backend_app_module, "NETWORK", os.getenv("NETWORK", "testnet")),
                "adapter": getattr(getattr(backend_app_module, "exchange_adapter", None), "mode", "unknown"),
                "kill_switch_active": ctx.kill_switch_active,
                "halted": ctx.kill_switch_active,
                "guardian_triggered": ctx.guardian_triggered,
                "market_data_mode": market_data["market_data_mode"],
                "market_data_connected": market_data["connected"],
                "market_data_source": market_data.get("source", "synthetic"),
                "uptime_seconds": round(time.time() - _STARTED_AT, 3),
            }

        async def hosted_ready() -> dict:
            allowed_origins = getattr(backend_app_module, "ALLOWED_ORIGINS", []) or []
            return {
                "status": "ok",
                "service": "crypto-signal-bot-backend",
                "runtime": "render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "asgi",
                "backend_api_key_configured": bool(os.getenv("BACKEND_API_KEY")),
                "cors_origins_configured": bool(allowed_origins),
                "cors_origin_count": len(allowed_origins),
            }

        for path in ("/health", "/healthz", "/api/health"):
            app.add_api_route(path, hosted_health, methods=["GET"], tags=["health"])
        _remove_existing_routes(app, "/ready", {"GET"})
        app.add_api_route("/ready", hosted_ready, methods=["GET"], tags=["health"])
    except Exception as exc:  # pragma: no cover - startup safety guard
        logger.warning("Unable to install hosted health overrides: %s", exc)


def _install_stream_latest_route() -> None:
    """Install a polling fallback for the canonical WebSocket stream.

    GPT Actions and some frontend clients cannot hold a WebSocket connection.
    This wraps the shared broadcast function so the most recent broadcast payload
    is available through GET /stream/latest without changing execution mode.
    """
    try:
        from backend import app as backend_app_module

        app = backend_app_module.app
        ctx = backend_app_module.context

        if not hasattr(ctx, "_latest_stream_event"):
            setattr(ctx, "_latest_stream_event", {})

        if not getattr(ctx, "_latest_stream_broadcast_wrapped", False):
            original_broadcast = ctx.broadcast

            async def broadcast_with_latest(event: Any):
                try:
                    if isinstance(event, dict):
                        latest = getattr(ctx, "_latest_stream_event")
                        latest.clear()
                        latest.update(event)
                        latest.setdefault("ts", time.time())
                except Exception as exc:  # pragma: no cover - defensive cache only
                    logger.warning("Unable to cache latest stream event: %s", exc)
                return await original_broadcast(event)

            ctx.broadcast = broadcast_with_latest
            setattr(ctx, "_latest_stream_broadcast_wrapped", True)

        async def stream_latest() -> dict:
            latest = getattr(ctx, "_latest_stream_event", {})
            if not latest:
                return {
                    "type": "none",
                    "message": "No events broadcast yet.",
                    "ts": time.time(),
                }
            return dict(latest)

        _remove_existing_routes(app, "/stream/latest", {"GET"})
        app.add_api_route("/stream/latest", stream_latest, methods=["GET"], tags=["stream"])
    except Exception as exc:  # pragma: no cover - startup safety guard
        logger.warning("Unable to install stream latest route: %s", exc)


_install_hosted_health_routes()
_install_stream_latest_route()


@compatibility_router.get("/account/summary")
def account_summary() -> dict:
    return {}


@compatibility_router.get("/signals/recent")
def signals_recent(symbol: str = "BTCUSDT") -> dict:
    return {}


@compatibility_router.get("/positions")
def positions() -> dict:
    return {}


@compatibility_router.get("/guardian/status")
def guardian_status() -> dict:
    return {}


@compatibility_router.get("/equity/history")
def equity_history(symbol: Optional[str] = None, limit: int = 100) -> dict:
    return {"trades": []}
