"""Rate limiting logic.

Uses a per-IP sliding window to cap requests per minute.

Thread safety: ``_store_lock`` serialises access to ``_rate_limit_store``
so the middleware is safe under concurrent workers.

Memory management: stale IPs whose last request is older than
``_rate_limit_window_seconds`` are evicted during each call, preventing
unbounded growth.

Note: When running behind a reverse proxy, configure it to set
``X-Forwarded-For`` and use a ``ProxyHeadersMiddleware`` so that
``request.client.host`` reflects the real client IP.
"""

import threading
import time
from typing import Dict, List

from fastapi import HTTPException, Request

from backend.config.runtime import get_runtime_config

RUNTIME_CONFIG = get_runtime_config()
_rate_limit_window_seconds = 60
_rate_limit_max_requests: int = RUNTIME_CONFIG.rate_limit_rpm
_rate_limit_store: Dict[str, List[float]] = {}
_store_lock = threading.Lock()


def rate_limit(request: Request) -> None:
    client_ip: str = request.client.host if request.client else "unknown"
    now: float = time.time()
    window_start: float = now - _rate_limit_window_seconds

    with _store_lock:
        # Evict stale IPs to prevent memory leak
        stale_keys = [
            ip for ip, ts_list in _rate_limit_store.items()
            if not ts_list or ts_list[-1] <= window_start
        ]
        for key in stale_keys:
            del _rate_limit_store[key]

        if client_ip not in _rate_limit_store:
            _rate_limit_store[client_ip] = []

        timestamps = _rate_limit_store[client_ip]
        _rate_limit_store[client_ip] = [t for t in timestamps if t > window_start]

        if len(_rate_limit_store[client_ip]) >= _rate_limit_max_requests:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Max {_rate_limit_max_requests} requests per minute.",
            )
        _rate_limit_store[client_ip].append(now)
