# backend/middleware/auth.py
"""
PHASE 12 — Auth and rate-limiting middleware.

Single middleware path for all write/control surface protection.

Design:
  - Write/control routes: X-API-Key enforced (when BACKEND_API_KEY is set)
  - Public GET routes: rate-limited by IP (token bucket, Redis-backed)
  - WebSocket /ws/updates: connection-level token check
  - Auth logic stays separate from business logic (dependency injection only)

Protected routes (require X-API-Key):
  POST /intent/paper
  POST /intent/live
  POST /kill-switch
  PUT  /risk/config
  DELETE /risk/config
  POST /earnings/reset
  POST /withdraw
  PUT  /auto-trade/enabled

Public routes (rate-limited GET only):
  GET  /health
  GET  /price
  GET  /prices/batch
  GET  /price/ohlcv
  GET  /signal/latest
  GET  /guardian/status
  GET  /balance
  GET  /orders
  GET  /audit
  GET  /metrics

Protected files: none accessed here.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import APIKeyHeader

from backend.config.loader import get_auth_config

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Write routes that always require X-API-Key when auth is enabled
# ---------------------------------------------------------------------------

WRITE_PATHS: set[str] = {
    "/intent/paper",
    "/intent/live",
    "/kill-switch",
    "/risk/config",
    "/earnings/reset",
    "/withdraw",
    "/auto-trade/enabled",
}

# ---------------------------------------------------------------------------
# X-API-Key dependency (reusable, composable)
# ---------------------------------------------------------------------------

_api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_write_auth(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    """
    FastAPI dependency for write endpoints.
    Raises 401 when auth is enabled and key is missing or wrong.
    No-op when BACKEND_API_KEY is not configured.
    """
    auth = get_auth_config()
    if not auth.auth_enabled:
        return
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "missing_api_key",
                "message": "X-API-Key header is required for this endpoint.",
            },
        )
    if x_api_key != auth.api_key:
        # Log invalid attempt (not the key itself)
        log.warning("Invalid X-API-Key attempt on write endpoint")
        raise HTTPException(
            status_code=401,
            detail={
                "error": "invalid_api_key",
                "message": "X-API-Key is invalid.",
            },
        )


# ---------------------------------------------------------------------------
# Rate limiter — token bucket per IP
# ---------------------------------------------------------------------------

# In-process fallback when Redis is unavailable
_rate_buckets: dict[str, tuple[float, float]] = {}  # ip -> (tokens, last_refill)

READ_RATE_LIMIT_RPS    = 10   # requests per second per IP
READ_RATE_LIMIT_BURST  = 30   # burst allowance


async def _get_redis_rate_client():
    try:
        import aioredis  # type: ignore
        from backend.config.loader import get_redis_config
        cfg = get_redis_config()
        return await aioredis.from_url(cfg.url, decode_responses=True)
    except Exception:
        return None


async def _check_rate_limit_redis(client_ip: str) -> bool:
    """
    Sliding window rate limit via Redis.
    Returns True if request is allowed, False if rate-limited.
    """
    r = await _get_redis_rate_client()
    if not r:
        return _check_rate_limit_memory(client_ip)

    try:
        key = f"ratelimit:{client_ip}"
        now = time.time()
        window = 1.0  # 1-second window
        pipe = r.pipeline()
        pipe.zadd(key, {str(now): now})
        pipe.zremrangebyscore(key, 0, now - window)
        pipe.zcard(key)
        pipe.expire(key, 10)
        results = await pipe.execute()
        count = results[2]
        return count <= READ_RATE_LIMIT_BURST
    except Exception:
        return True  # fail open


def _check_rate_limit_memory(client_ip: str) -> bool:
    """In-process fallback rate limiter (token bucket)."""
    now = time.time()
    if client_ip in _rate_buckets:
        tokens, last = _rate_buckets[client_ip]
        refill = (now - last) * READ_RATE_LIMIT_RPS
        tokens = min(READ_RATE_LIMIT_BURST, tokens + refill)
    else:
        tokens = READ_RATE_LIMIT_BURST

    if tokens >= 1:
        _rate_buckets[client_ip] = (tokens - 1, now)
        return True
    else:
        _rate_buckets[client_ip] = (tokens, now)
        return False


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit_public(request: Request) -> None:
    """
    FastAPI dependency for public GET endpoints.
    Returns 429 if the IP has exceeded the rate limit.
    """
    ip = get_client_ip(request)
    allowed = await _check_rate_limit_redis(ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Too many requests. Limit: {READ_RATE_LIMIT_RPS} req/s.",
                "retry_after_seconds": 1,
            },
            headers={"Retry-After": "1"},
        )


# ---------------------------------------------------------------------------
# WebSocket auth — connection-level token check
# ---------------------------------------------------------------------------

async def verify_ws_token(token: Optional[str]) -> bool:
    """
    Verify a WebSocket connection token.
    For private channels: token must match BACKEND_API_KEY.
    For public channels (market_updates, signal_updates): no token required.
    """
    auth = get_auth_config()
    if not auth.auth_enabled:
        return True
    if not token:
        return False
    return token == auth.api_key


# ---------------------------------------------------------------------------
# CORS middleware config (returned for use in app factory)
# ---------------------------------------------------------------------------

def get_cors_config() -> dict:
    from backend.config.loader import get_settings
    settings = get_settings()
    origins = settings.cors_allowed_origins or ["*"]
    return {
        "allow_origins":     origins,
        "allow_credentials": True,
        "allow_methods":     ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers":     ["*"],
    }
