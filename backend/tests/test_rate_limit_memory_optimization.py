"""Regression tests for the in-process fallback rate limiter."""

from collections import deque

import pytest
from fastapi import HTTPException

from backend.logic import rate_limit as rate_limit_module


@pytest.fixture(autouse=True)
def reset_rate_limit_state(monkeypatch):
    original_max = rate_limit_module._rate_limit_max_requests
    original_window = rate_limit_module._rate_limit_window_seconds
    original_cleanup_interval = rate_limit_module._cleanup_interval_seconds
    rate_limit_module._rate_limit_store.clear()
    rate_limit_module._last_cleanup_time = 0.0
    rate_limit_module._rate_limit_max_requests = 2
    rate_limit_module._rate_limit_window_seconds = 60
    rate_limit_module._cleanup_interval_seconds = 10.0
    yield
    rate_limit_module._rate_limit_store.clear()
    rate_limit_module._last_cleanup_time = 0.0
    rate_limit_module._rate_limit_max_requests = original_max
    rate_limit_module._rate_limit_window_seconds = original_window
    rate_limit_module._cleanup_interval_seconds = original_cleanup_interval


def test_first_request_creates_deque(monkeypatch):
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    rate_limit_module._rate_limit_memory("198.51.100.1")

    timestamps = rate_limit_module._rate_limit_store["198.51.100.1"]
    assert isinstance(timestamps, deque)
    assert list(timestamps) == [100.0]


def test_existing_list_state_is_normalized_to_deque(monkeypatch):
    rate_limit_module._rate_limit_store["198.51.100.2"] = [80.0, 95.0]
    rate_limit_module._last_cleanup_time = 95.0
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    with pytest.raises(HTTPException) as exc_info:
        rate_limit_module._rate_limit_memory("198.51.100.2")

    assert exc_info.value.status_code == 429
    assert isinstance(rate_limit_module._rate_limit_store["198.51.100.2"], deque)


def test_request_is_rejected_after_limit(monkeypatch):
    times = iter([100.0, 101.0, 102.0])
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: next(times))

    rate_limit_module._rate_limit_memory("198.51.100.3")
    rate_limit_module._rate_limit_memory("198.51.100.3")
    with pytest.raises(HTTPException) as exc_info:
        rate_limit_module._rate_limit_memory("198.51.100.3")

    assert exc_info.value.status_code == 429
    assert exc_info.value.headers == {"Retry-After": "60"}


def test_expired_timestamps_are_pruned_lazily(monkeypatch):
    rate_limit_module._rate_limit_store["198.51.100.4"] = deque([1.0, 2.0])
    rate_limit_module._last_cleanup_time = 100.0
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    rate_limit_module._rate_limit_memory("198.51.100.4")

    assert list(rate_limit_module._rate_limit_store["198.51.100.4"]) == [100.0]


def test_periodic_cleanup_removes_other_stale_clients(monkeypatch):
    rate_limit_module._rate_limit_store["stale"] = deque([1.0])
    rate_limit_module._rate_limit_store["active"] = deque([95.0])
    rate_limit_module._last_cleanup_time = 0.0
    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 100.0)

    rate_limit_module._rate_limit_memory("new-client")

    assert "stale" not in rate_limit_module._rate_limit_store
    assert "active" in rate_limit_module._rate_limit_store
    assert list(rate_limit_module._rate_limit_store["new-client"]) == [100.0]
