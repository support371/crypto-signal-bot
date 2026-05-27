"""ASGI health wrapper for hosted deployments.

Render can mark a service unhealthy when its configured health-check path fails,
even if the application root is reachable. This module makes the hosted health
paths dependency-free and intercepts them before the full FastAPI app/router is
entered. All non-health traffic is lazily delegated to the canonical backend app.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Awaitable, Callable, Dict

_STARTED_AT = time.time()
_INTERCEPT_PATHS = {"/", "/health", "/healthz", "/api/health", "/ready"}
_delegate_app: Callable[[Dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]], Awaitable[Any]] | None = None


def _json_response(body: dict[str, Any], status: int = 200) -> tuple[int, list[tuple[bytes, bytes]], bytes]:
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"cache-control", b"no-store"),
        (b"content-length", str(len(payload)).encode("ascii")),
    ]
    return status, headers, payload


def _get_payload(path: str) -> dict[str, Any]:
    if path == "/":
        return {
            "name": "Crypto Signal Bot API",
            "version": "2.2.0",
            "status": "online",
            "docs": "/docs",
            "health": "/health",
        }
    if path == "/ready":
        return {
            "status": "ok",
            "service": "crypto-signal-bot-backend",
            "runtime": "render",
            "mode": os.getenv("TRADING_MODE", "paper"),
        }

    # Payload for /health, /healthz, /api/health
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render",
        "mode": os.getenv("TRADING_MODE", "paper"),
        "network": os.getenv("NETWORK", "testnet"),
        "uptime_seconds": 0,
    }


def _get_delegate_app() -> Callable[[Dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]], Awaitable[Any]]:
    global _delegate_app
    if _delegate_app is None:
        from backend.render_entrypoint import app as render_app
        _delegate_app = render_app
    return _delegate_app


async def _send_response(send: Callable[..., Awaitable[Any]], body: dict[str, Any], method: str, status: int = 200) -> None:
    status_code, headers, payload = _json_response(body, status=status)
    await send({"type": "http.response.start", "status": status_code, "headers": headers})

    if method == "HEAD":
        # Send empty body for HEAD requests as required
        await send({"type": "http.response.body", "body": b""})
    else:
        await send({"type": "http.response.body", "body": payload})


async def app(scope: Dict[str, Any], receive: Callable[..., Awaitable[Any]], send: Callable[..., Awaitable[Any]]) -> None:
    if scope.get("type") == "lifespan":
        await _get_delegate_app()(scope, receive, send)
        return

    if scope.get("type") == "http":
        method = str(scope.get("method") or "GET").upper()
        path = str(scope.get("path") or "")

        if path in _INTERCEPT_PATHS and method in ("GET", "HEAD"):
            payload = _get_payload(path)
            await _send_response(send, payload, method)
            return

    # Lazily delegate all non-health/non-root traffic
    await _get_delegate_app()(scope, receive, send)
