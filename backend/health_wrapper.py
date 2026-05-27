"""ASGI health wrapper for hosted deployments.

Render can mark a service unhealthy when its configured health-check path fails,
even if the application root is reachable. This module makes hosted root,
liveness, and readiness probes dependency-free and handles Render HEAD probes
before the full FastAPI app/router stack is entered. All non-probe traffic is
lazily delegated to the canonical backend app.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Awaitable, Callable, Dict

_STARTED_AT = time.time()
_HEALTH_PATHS = {"/health", "/healthz", "/api/health"}
_READY_PATHS = {"/ready"}
_ROOT_PATHS = {"/", ""}
_delegate_app: Callable[[Dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]], Awaitable[Any]] | None = None


def _json_response(body: dict[str, Any], status: int = 200) -> tuple[int, list[tuple[bytes, bytes]], bytes]:
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"cache-control", b"no-store"),
        (b"content-length", str(len(payload)).encode("ascii")),
    ]
    return status, headers, payload


def _health_payload(path: str = "/health") -> dict[str, Any]:
    if path == "/healthz":
        return {"status": "ok"}
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "asgi",
        "mode": os.getenv("TRADING_MODE", "paper"),
        "network": os.getenv("NETWORK", "testnet"),
        "uptime_seconds": round(time.time() - _STARTED_AT, 3),
    }


def _ready_payload() -> dict[str, Any]:
    # Keep readiness public and generic. Do not expose API-key or CORS details.
    return {
        "status": "ok",
        "service": "crypto-signal-bot-backend",
        "runtime": "render" if os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") else "asgi",
        "mode": os.getenv("TRADING_MODE", "paper"),
    }


def _root_payload() -> dict[str, Any]:
    return {
        "name": "Crypto Signal Bot API",
        "version": "2.2.0",
        "status": "online",
        "docs": "/docs",
        "health": "/health",
    }


def _get_delegate_app() -> Callable[[Dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]], Awaitable[Any]]:
    global _delegate_app
    if _delegate_app is None:
        from backend.render_entrypoint import app as render_app

        _delegate_app = render_app
    return _delegate_app


async def _send_json(
    send: Callable[..., Awaitable[Any]],
    body: dict[str, Any],
    status: int = 200,
    method: str | None = None,
) -> None:
    """Send JSON for GET and headers-only for HEAD probes."""
    status_code, headers, payload = _json_response(body, status=status)
    await send({"type": "http.response.start", "status": status_code, "headers": headers})
    if (method or "").upper() == "HEAD":
        await send({"type": "http.response.body", "body": b""})
    else:
        await send({"type": "http.response.body", "body": payload})


async def app(scope: Dict[str, Any], receive: Callable[..., Awaitable[Any]], send: Callable[..., Awaitable[Any]]) -> None:
    if scope.get("type") == "lifespan":
        await _get_delegate_app()(scope, receive, send)
        return

    if scope.get("type") == "http":
        path = str(scope.get("path") or "")
        method = str(scope.get("method") or "GET").upper()
        if path in _ROOT_PATHS and method in {"GET", "HEAD"}:
            await _send_json(send, _root_payload(), method=method)
            return
        if path in _HEALTH_PATHS and method in {"GET", "HEAD"}:
            await _send_json(send, _health_payload(path), method=method)
            return
        if path in _READY_PATHS and method in {"GET", "HEAD"}:
            await _send_json(send, _ready_payload(), method=method)
            return

    await _get_delegate_app()(scope, receive, send)
