"""Rate limiting logic.

Uses a per-IP sliding window to cap requests per minute.

Production hardening:
  - Redis-backed atomic sliding window when Redis is available (multi-worker safe)
  - In-process fallback with thread lock when Redis is unavailable
  - Trusts forwarded client IPs only from explicitly configured proxy networks
  - Memory management: stale IPs are evicted without a full scan per request

Configure TRUSTED_PROXY_CIDRS with the exact proxy or load-balancer networks that
are allowed to supply X-Forwarded-For. When it is empty, forwarded headers are
ignored and the direct peer address is used.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from ipaddress import IPv4Network, IPv6Network, ip_address, ip_network
from typing import Optional

from fastapi import HTTPException, Request

from backend.config.runtime import get_runtime_config

RUNTIME_CONFIG = get_runtime_config()
_rate_limit_window_seconds = 60
_rate_limit_max_requests: int = RUNTIME_CONFIG.rate_limit_rpm
_rate_limit_store: dict[str, deque[float] | list[float]] = {}
_store_lock = threading.Lock()
_last_cleanup_time: float = 0.0
_cleanup_interval_seconds: float = 10.0

logger = logging.getLogger(__name__)


def _build_trusted_proxy_networks(
    cidr_values: list[str],
) -> tuple[IPv4Network | IPv6Network, ...]:
    networks: list[IPv4Network | IPv6Network] = []
    for value in cidr_values:
        try:
            networks.append(ip_network(value, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXY_CIDRS entry")
    return tuple(networks)


_trusted_proxy_networks = _build_trusted_proxy_networks(
    RUNTIME_CONFIG.server.trusted_proxy_cidrs
)

# Optional async Redis client (set on first use)
_redis_client = None
_redis_available: Optional[bool] = None  # None = not yet tested

_REDIS_RATE_LIMIT_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
local member = ARGV[5]

redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start)
local count = redis.call("ZCARD", key)

if count >= max_requests then
    redis.call("EXPIRE", key, ttl_seconds)
    return 0
end

redis.call("ZADD", key, now, member)
redis.call("EXPIRE", key, ttl_seconds)
return 1
"""


def _normalize_ip(value: str) -> str | None:
    """Return a canonical IP string, rejecting malformed forwarded-hop values."""
    candidate = value.strip()
    if not candidate or candidate.lower() == "unknown":
        return None

    # Accept bracketed IPv6 and IPv4-with-port forms occasionally emitted by proxies.
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    elif candidate.count(":") == 1 and "." in candidate:
        host, port = candidate.rsplit(":", 1)
        if port.isdigit():
            candidate = host

    try:
        return str(ip_address(candidate))
    except ValueError:
        return None


def _is_trusted_proxy(value: str) -> bool:
    normalized = _normalize_ip(value)
    if normalized is None:
        return False
    address = ip_address(normalized)
    return any(address in network for network in _trusted_proxy_networks)


def _get_client_ip(request: Request) -> str:
    """Resolve the client IP without trusting attacker-controlled proxy headers.

    The direct peer is always authoritative unless it belongs to a configured
    trusted proxy network. For trusted proxy chains, walk X-Forwarded-For from
    right to left and return the first untrusted hop.
    """
    peer = request.client.host if request.client else "unknown"
    normalized_peer = _normalize_ip(peer) or peer
    forwarded = request.headers.get("X-Forwarded-For")

    if not forwarded or not _is_trusted_proxy(normalized_peer):
        return normalized_peer

    forwarded_hops = [
        normalized
        for raw_hop in forwarded.split(",")
        if (normalized := _normalize_ip(raw_hop)) is not None
    ]
    for hop in reversed(forwarded_hops):
        if not _is_trusted_proxy(hop):
            return hop

    # Fail closed when the chain is malformed or contains only trusted proxies.
    return normalized_peer


def _rate_limit_memory(client_ip: str) -> None:
    """In-process fallback rate limiter (thread-safe sliding window)."""
    global _last_cleanup_time
    now: float = time.time()
    window_start: float = now - _rate_limit_window_seconds

    with _store_lock:
        should_cleanup = (
            now < _last_cleanup_time
            or now - _last_cleanup_time >= _cleanup_interval_seconds
        )
        if should_cleanup:
            stale_keys = [
                ip
                for ip, timestamps in _rate_limit_store.items()
                if not timestamps or timestamps[-1] <= window_start
            ]
            for key in stale_keys:
                del _rate_limit_store[key]
            _last_cleanup_time = now

        timestamps = _rate_limit_store.get(client_ip)
        if timestamps is None:
            timestamps = deque()
            _rate_limit_store[client_ip] = timestamps
        elif isinstance(timestamps, list):
            timestamps = deque(timestamps)
            _rate_limit_store[client_ip] = timestamps

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
    """Apply an atomic Redis-backed sliding window.

    Returns True when Redis handled the request, or False when callers should
    fall back to the in-process limiter. Raises HTTPException(429) when blocked.
    """
    global _redis_client, _redis_available
    try:
        if _redis_client is None:
            try:
                import aioredis  # type: ignore

                from backend.config.settings import get_settings

                settings = get_settings()
                _redis_client = await aioredis.from_url(
                    settings.redis_url,
                    decode_responses=True,
                    socket_timeout=1.0,
                )
                _redis_available = True
            except Exception:
                _redis_available = False
                return False

        now = time.time()
        window_start = now - _rate_limit_window_seconds
        key = f"ratelimit:{client_ip}"
        ttl_seconds = _rate_limit_window_seconds + 5
        member = f"{now:.9f}:{uuid.uuid4().hex}"

        allowed = await _redis_client.eval(
            _REDIS_RATE_LIMIT_SCRIPT,
            1,
            key,
            now,
            window_start,
            _rate_limit_max_requests,
            ttl_seconds,
            member,
        )
        if int(allowed) != 1:
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
    """Apply the in-process limiter used by existing synchronous dependencies."""
    client_ip = _get_client_ip(request)
    _rate_limit_memory(client_ip)


async def rate_limit_async(request: Request) -> None:
    """Prefer Redis and fail over to the in-process limiter when unavailable."""
    client_ip = _get_client_ip(request)
    redis_handled = await _rate_limit_redis(client_ip)
    if not redis_handled:
        _rate_limit_memory(client_ip)
