"""Rate limiting logic.

Uses a per-IP sliding window to cap requests per minute.

Production hardening:
  - Redis-backed sliding window when Redis is available (multi-worker safe)
  - In-process fallback with thread lock when Redis is unavailable
  - Reads real client IP from X-Forwarded-For (proxy-aware)
  - Memory management: stale IPs evicted to prevent unbounded growth

Note: When running behind a reverse proxy (nginx, Render, Vercel), configure
it to set X-Forwarded-For so that the real client IP is rate-limited,
not the proxy's IP.
"""

from __future__ import annotations

from collections import deque
import threading
import time
from typing import Dict, List, Optional

from fastapi import HTTPException, Request

from backend.config.runtime import get_runtime_config

RUNTIME_CONFIG = get_runtime_config()
_rate_limit_window_seconds = 60
_rate_limit_max_requests: int = RUNTIME_CONFIG.rate_limit_rpm
_rate_limit_store: Dict[str, deque[float]] = {}
_store_lock = threading.Lock()
_last_cleanup_time: float = 0.0

# Optional async Redis client (set on first use)
_redis_client = None
_redis_available: Optional[bool] = None  # None = not yet tested


def _get_client_ip(request: Request) -> str:
    """Extract real client IP, respecting X-Forwarded-For from reverse proxies."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limit_memory(client_ip: str) -> None:
    """In-process fallback rate limiter (thread-safe sliding window)."""
    global _last_cleanup_time
    now: float = time.time()
    window_start: float = now - _rate_limit_window_seconds

    with _store_lock:
        # Decouple the O(N) global stale IP cleanup to run periodically (every 10 seconds)
        # to prevent performance degradation under sustained load.
        if now - _last_cleanup_time >= 10.0:
            stale_keys = [
                ip for ip, ts_deque in _rate_limit_store.items()
                if not ts_deque or ts_deque[-1] <= window_start
            ]
            for key in stale_keys:
                del _rate_limit_store[key]
            _last_cleanup_time = now

        if client_ip not in _rate_limit_store:
            _rate_limit_store[client_ip] = deque()

        timestamps = _rate_limit_store[client_ip]
        # Lazily prune stale timestamps with popleft() (O(1) pop operation)
        # to avoid costly list slicing or recreating lists.
        while timestamps and timestamps[0] <= window_start:
            timestamps.popleft()

        if len(timestamps) >= _rate_limit_max_requests:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Max {_rate_limit_max_requests} requests per minute.",
                headers={"Retry-After": "60"},
            )
        timestamps.append(now)


async def _rate_limit_redis(client_ip: str) -> bool:
    """
    Redis-backed sliding window rate limiter.
    Returns True if allowed, False if should fall back to memory.
    Raises HTTPException(429) if rate limited.
    """
    global _redis_client, _redis_available
    try:
        if _redis_client is None:
            try:
                import aioredis  # type: ignore
                from backend.config.settings import get_settings
                settings = get_settings()
                _redis_client = await aioredis.from_url(
                    settings.redis_url, decode_responses=True, socket_timeout=1.0
                )
                _redis_available = True
            except Exception:
                _redis_available = False
                return False

        now = time.time()
        window_start = now - _rate_limit_window_seconds
        key = f"ratelimit:{client_ip}"

        pipe = _redis_client.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zcard(key)
        pipe.zadd(key, {str(now): now})
        pipe.expire(key, _rate_limit_window_seconds + 5)
        results = await pipe.execute()
        count = results[1]  # count before this request

        if count >= _rate_limit_max_requests:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Max {_rate_limit_max_requests} requests per minute.",
                headers={"Retry-After": "60"},
            )
        return True
    except HTTPException:
        raise
    except Exception:
        _redis_available = False
        _redis_client = None
        return False


def rate_limit(request: Request) -> None:
    """
    Sync rate-limit dependency (used by existing routes via Depends).
    Falls back to in-process store — works for single-worker deployments.

    For multi-worker production, use rate_limit_async instead, or ensure
    the app uses a single worker + Redis pub/sub (recommended).
    """
    client_ip = _get_client_ip(request)
    _rate_limit_memory(client_ip)


async def rate_limit_async(request: Request) -> None:
    """
    Async rate-limit dependency with Redis-backed sliding window.
    Falls back to in-process store if Redis is unavailable.
    Use this for new routes or when updating existing ones.
    """
    client_ip = _get_client_ip(request)
    redis_handled = await _rate_limit_redis(client_ip)
    if not redis_handled:
        _rate_limit_memory(client_ip)
