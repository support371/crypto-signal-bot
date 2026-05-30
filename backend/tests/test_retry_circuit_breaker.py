"""Tests for the production retry + circuit breaker utilities."""

from __future__ import annotations

import asyncio
import pytest

from backend.adapters.exchanges.base import (
    AdapterUnavailableError,
    AdapterRateLimitError,
    AdapterAuthError,
)
from backend.adapters.exchanges.retry import with_retry, CircuitBreaker, CircuitState


# ---------------------------------------------------------------------------
# with_retry tests
# ---------------------------------------------------------------------------

class TestWithRetry:
    @pytest.mark.asyncio
    async def test_success_no_retry(self):
        calls = []
        @with_retry(max_attempts=3, base_delay=0)
        async def fn():
            calls.append(1)
            return "ok"
        result = await fn()
        assert result == "ok"
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_retries_on_unavailable(self):
        calls = []
        @with_retry(max_attempts=3, base_delay=0)
        async def fn():
            calls.append(1)
            if len(calls) < 3:
                raise AdapterUnavailableError("transient")
            return "ok"
        result = await fn()
        assert result == "ok"
        assert len(calls) == 3

    @pytest.mark.asyncio
    async def test_raises_after_max_attempts(self):
        calls = []
        @with_retry(max_attempts=3, base_delay=0)
        async def fn():
            calls.append(1)
            raise AdapterUnavailableError("always fails")
        with pytest.raises(AdapterUnavailableError):
            await fn()
        assert len(calls) == 3

    @pytest.mark.asyncio
    async def test_auth_error_not_retried(self):
        calls = []
        @with_retry(max_attempts=3, base_delay=0)
        async def fn():
            calls.append(1)
            raise AdapterAuthError("bad credentials")
        with pytest.raises(AdapterAuthError):
            await fn()
        assert len(calls) == 1  # must NOT retry

    @pytest.mark.asyncio
    async def test_rate_limit_retried(self):
        calls = []
        @with_retry(max_attempts=2, base_delay=0)
        async def fn():
            calls.append(1)
            if len(calls) < 2:
                raise AdapterRateLimitError("429")
            return "ok"
        result = await fn()
        assert result == "ok"
        assert len(calls) == 2


# ---------------------------------------------------------------------------
# CircuitBreaker tests
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    @pytest.mark.asyncio
    async def test_starts_closed(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=1.0)
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_opens_after_threshold(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60.0, name="test")
        for _ in range(3):
            try:
                async with cb:
                    raise AdapterUnavailableError("fail")
            except AdapterUnavailableError:
                pass
        assert cb.state == CircuitState.OPEN

    @pytest.mark.asyncio
    async def test_open_raises_without_calling_fn(self):
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=60.0, name="test")
        try:
            async with cb:
                raise AdapterUnavailableError("trip")
        except AdapterUnavailableError:
            pass
        assert cb.state == CircuitState.OPEN
        with pytest.raises(AdapterUnavailableError, match="Circuit breaker OPEN"):
            async with cb:
                pass  # should never get here

    @pytest.mark.asyncio
    async def test_success_resets_failure_count(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60.0, name="test")
        # 2 failures then success
        for _ in range(2):
            try:
                async with cb:
                    raise AdapterUnavailableError("fail")
            except AdapterUnavailableError:
                pass
        async with cb:
            pass  # success
        assert cb._failure_count == 0
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_auth_error_does_not_trip_breaker(self):
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=60.0, name="test")
        try:
            async with cb:
                raise AdapterAuthError("bad key")
        except AdapterAuthError:
            pass
        assert cb._failure_count == 0
        assert cb.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_half_open_after_recovery(self):
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.01, name="test")
        try:
            async with cb:
                raise AdapterUnavailableError("trip")
        except AdapterUnavailableError:
            pass
        assert cb.state == CircuitState.OPEN
        await asyncio.sleep(0.05)
        assert cb.state == CircuitState.HALF_OPEN

    @pytest.mark.asyncio
    async def test_half_open_success_closes(self):
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.01, name="test")
        try:
            async with cb:
                raise AdapterUnavailableError("trip")
        except AdapterUnavailableError:
            pass
        await asyncio.sleep(0.05)
        assert cb.state == CircuitState.HALF_OPEN
        async with cb:
            pass  # probe success
        assert cb.state == CircuitState.CLOSED

    def test_get_status(self):
        cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0, name="binance")
        status = cb.get_status()
        assert status["name"] == "binance"
        assert status["state"] == "closed"
        assert status["failure_count"] == 0
        assert status["failure_threshold"] == 5
