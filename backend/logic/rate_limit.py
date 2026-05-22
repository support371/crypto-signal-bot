"""Rate limiting logic."""
import time
from typing import Dict, List
from fastapi import HTTPException, Request
from backend.config.runtime import get_runtime_config

RUNTIME_CONFIG = get_runtime_config()
_rate_limit_window_seconds = 60
_rate_limit_max_requests = RUNTIME_CONFIG.rate_limit_rpm
_rate_limit_store: Dict[str, List[float]] = {}

def rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    window_start = now - _rate_limit_window_seconds

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
