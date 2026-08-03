"""Unit tests for the optimized in-memory rate limiter."""

import time
import pytest
from collections import deque
from fastapi import HTTPException
from backend.logic.rate_limit import (
    _rate_limit_memory,
    _rate_limit_store,
    _rate_limit_max_requests,
    _rate_limit_window_seconds,
)

def test_rate_limit_basic_allowed():
    """Verify that requests are allowed within the rate limit."""
    # Clean the store before testing
    _rate_limit_store.clear()

    client_ip = "127.0.0.1"
    # Execute a few requests, should not raise any exception
    for _ in range(5):
        _rate_limit_memory(client_ip)

    assert client_ip in _rate_limit_store
    assert len(_rate_limit_store[client_ip]) == 5


def test_rate_limit_exceeded_raises_429():
    """Verify that exceeding the rate limit raises an HTTPException with 429 status code."""
    _rate_limit_store.clear()
    client_ip = "192.168.1.1"

    # Fill the limit
    for _ in range(_rate_limit_max_requests):
        _rate_limit_memory(client_ip)

    # The next one must trigger a 429
    with pytest.raises(HTTPException) as exc_info:
        _rate_limit_memory(client_ip)

    assert exc_info.value.status_code == 429
    assert "Rate limit exceeded" in exc_info.value.detail


def test_rate_limit_sliding_window_eviction():
    """Verify that old timestamps are correctly evicted from the sliding window."""
    _rate_limit_store.clear()
    client_ip = "10.0.0.1"

    # Manually inject some expired timestamps
    now = time.time()
    expired_ts = now - (_rate_limit_window_seconds + 10)

    _rate_limit_store[client_ip] = deque([expired_ts, expired_ts, now])

    # Running rate limit memory should prune the expired timestamps, leaving only the recent one and adding the new one
    _rate_limit_memory(client_ip)

    assert len(_rate_limit_store[client_ip]) == 2
    assert _rate_limit_store[client_ip][0] == now
