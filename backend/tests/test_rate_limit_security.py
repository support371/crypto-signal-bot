"""Security and regression tests for the API rate limiter."""

from __future__ import annotations

from collections import deque
from ipaddress import ip_network

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.config.runtime import get_runtime_config
from backend.logic import rate_limit as rate_limit_module


def _request(peer: str, forwarded_for: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode("ascii")))
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers,
            "client": (peer, 12345),
            "server": ("testserver", 443),
            "root_path": "",
        }
    )


@pytest.fixture(autouse=True)
def reset_rate_limit_state():
    original_max = rate_limit_module._rate_limit_max_requests
    original_window = rate_limit_module._rate_limit_window_seconds
    original_cleanup_interval = rate_limit_module._cleanup_interval_seconds
    original_networks = rate_limit_module._trusted_proxy_networks
    original_redis_client = rate_limit_module._redis_client
    original_redis_available = rate_limit_module._redis_available

    rate_limit_module._rate_limit_store.clear()
    rate_limit_module._last_cleanup_time = 0.0
    rate_limit_module._rate_limit_max_requests = 2
    rate_limit_module._rate_limit_window_seconds = 60
    rate_limit_module._cleanup_interval_seconds = 10.0
    rate_limit_module._trusted_proxy_networks = ()
    rate_limit_module._redis_client = None
    rate_limit_module._redis_available = None

    yield

    rate_limit_module._rate_limit_store.clear()
    rate_limit_module._last_cleanup_time = 0.0
    rate_limit_module._rate_limit_max_requests = original_max
    rate_limit_module._rate_limit_window_seconds = original_window
    rate_limit_module._cleanup_interval_seconds = original_cleanup_interval
    rate_limit_module._trusted_proxy_networks = original_networks
    rate_limit_module._redis_client = original_redis_client
    rate_limit_module._redis_available = original_redis_available


def test_runtime_config_reads_trusted_proxy_cidrs(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "127.0.0.1/32,10.20.0.0/16")

    config = get_runtime_config()

    assert config.server.trusted_proxy_cidrs == [
        "127.0.0.1/32",
        "10.20.0.0/16",
    ]


def test_untrusted_peer_cannot_spoof_forwarded_client_ip():
    request = _request("198.51.100.10", "203.0.113.44")

    assert rate_limit_module._get_client_ip(request) == "198.51.100.10"


def test_trusted_proxy_chain_returns_first_untrusted_hop():
    rate_limit_module._trusted_proxy_networks = (
        ip_network("10.0.0.0/8"),
        ip_network("192.0.2.10/32"),
    )
    request = _request(
        "10.0.0.5",
        "203.0.113.44, 192.0.2.10",
    )

    assert rate_limit_module._get_client_ip(request) == "203.0.113.44"


def test_malformed_or_all_trusted_forwarded_chain_fails_closed():
    rate_limit_module._trusted_proxy_networks = (ip_network("10.0.0.0/8"),)

    malformed = _request("10.0.0.5", "unknown, not-an-ip")
    all_trusted = _request("10.0.0.5", "10.0.0.7, 10.0.0.8")

    assert rate_limit_module._get_client_ip(malformed) == "10.0.0.5"
    assert rate_limit_module._get_client_ip(all_trusted) == "10.0.0.5"


def test_memory_limiter_uses_deque_and_rejects_after_limit(monkeypatch):
    times = iter([100.0, 101.0, 102.0])
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: next(times))

    rate_limit_module._rate_limit_memory("198.51.100.1")
    rate_limit_module._rate_limit_memory("198.51.100.1")

    with pytest.raises(HTTPException) as exc_info:
        rate_limit_module._rate_limit_memory("198.51.100.1")

    assert isinstance(rate_limit_module._rate_limit_store["198.51.100.1"], deque)
    assert exc_info.value.status_code == 429
    assert exc_info.value.headers == {"Retry-After": "60"}


def test_memory_limiter_normalizes_existing_list_and_prunes_expired(monkeypatch):
    rate_limit_module._rate_limit_store["198.51.100.2"] = [1.0, 95.0]
    rate_limit_module._last_cleanup_time = 95.0
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    rate_limit_module._rate_limit_memory("198.51.100.2")

    timestamps = rate_limit_module._rate_limit_store["198.51.100.2"]
    assert isinstance(timestamps, deque)
    assert list(timestamps) == [95.0, 100.0]


def test_periodic_cleanup_handles_clock_rollback(monkeypatch):
    rate_limit_module._rate_limit_store["stale"] = deque([1.0])
    rate_limit_module._last_cleanup_time = 200.0
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    rate_limit_module._rate_limit_memory("new-client")

    assert "stale" not in rate_limit_module._rate_limit_store
    assert list(rate_limit_module._rate_limit_store["new-client"]) == [100.0]


class _FakeRedis:
    def __init__(self, result: int = 1, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[tuple[object, ...]] = []

    async def eval(self, *args):
        self.calls.append(args)
        if self.error is not None:
            raise self.error
        return self.result


@pytest.mark.asyncio
async def test_redis_limiter_uses_atomic_script(monkeypatch):
    fake = _FakeRedis(result=1)
    rate_limit_module._redis_client = fake
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    handled = await rate_limit_module._rate_limit_redis("198.51.100.3")

    assert handled is True
    assert len(fake.calls) == 1
    script, key_count, key, now, window_start, maximum, ttl, member = fake.calls[0]
    assert "ZREMRANGEBYSCORE" in script
    assert "ZCARD" in script
    assert key_count == 1
    assert key == "ratelimit:198.51.100.3"
    assert now == 100.0
    assert window_start == 40.0
    assert maximum == 2
    assert ttl == 65
    assert member.startswith("100.000000000:")


@pytest.mark.asyncio
async def test_redis_limiter_rejects_without_falling_back():
    rate_limit_module._redis_client = _FakeRedis(result=0)

    with pytest.raises(HTTPException) as exc_info:
        await rate_limit_module._rate_limit_redis("198.51.100.4")

    assert exc_info.value.status_code == 429


@pytest.mark.asyncio
async def test_redis_failure_fails_over_to_memory():
    rate_limit_module._redis_client = _FakeRedis(error=ConnectionError("offline"))

    handled = await rate_limit_module._rate_limit_redis("198.51.100.5")

    assert handled is False
    assert rate_limit_module._redis_client is None
    assert rate_limit_module._redis_available is False
