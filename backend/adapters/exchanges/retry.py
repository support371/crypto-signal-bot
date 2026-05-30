# backend/adapters/exchanges/retry.py
"""
Production retry + circuit-breaker utilities for exchange adapters.

Usage:
    from backend.adapters.exchanges.retry import with_retry, CircuitBreaker

    @with_retry(max_attempts=3, base_delay=0.5)
    async def my_exchange_call():
        ...

Circuit breaker state is per-adapter-instance (not global), so one
failing exchange does not affect another.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import time
from enum import Enum
from typing import Callable, Optional, Type, Tuple

from backend.adapters.exchanges.base import (
    AdapterRateLimitError,
    AdapterUnavailableError,
    AdapterAuthError,
)

log = logging.getLogger(__name__)

# Exceptions that are retriable (transient)
RETRIABLE_EXCEPTIONS: Tuple[Type[Exception], ...] = (
    AdapterUnavailableError,
    AdapterRateLimitError,
    ConnectionError,
    TimeoutError,
    OSError,
)

# Exceptions that are NOT retriable (permanent)
NON_RETRIABLE_EXCEPTIONS: Tuple[Type[Exception], ...] = (
    AdapterAuthError,
)


def with_retry(
    max_attempts: int = 3,
    base_delay: float = 0.5,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    retriable: Tuple[Type[Exception], ...] = RETRIABLE_EXCEPTIONS,
    non_retriable: Tuple[Type[Exception], ...] = NON_RETRIABLE_EXCEPTIONS,
):
    """
    Decorator: retry an async function with exponential backoff.

    - Non-retriable exceptions (auth, symbol not found) propagate immediately.
    - Rate limit errors use a longer initial delay (2s).
    - After all attempts are exhausted, re-raises the last exception.
    """
    def decorator(fn: Callable):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            last_exc: Optional[Exception] = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return await fn(*args, **kwargs)
                except non_retriable:
                    raise  # never retry auth/symbol errors
                except retriable as exc:
                    last_exc = exc
                    if attempt == max_attempts:
                        break
                    # Rate limit: longer initial delay
                    delay_base = 2.0 if isinstance(exc, AdapterRateLimitError) else base_delay
                    delay = min(delay_base * (backoff_factor ** (attempt - 1)), max_delay)
                    log.warning(
                        "[retry] %s attempt %d/%d failed: %s — retrying in %.1fs",
                        fn.__qualname__, attempt, max_attempts, exc, delay,
                    )
                    await asyncio.sleep(delay)
                except Exception:
                    raise
            log.error("[retry] %s failed after %d attempts: %s", fn.__qualname__, max_attempts, last_exc)
            raise last_exc  # type: ignore[misc]
        return wrapper
    return decorator


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """
    Per-adapter circuit breaker.

    State machine:
      CLOSED -> failure_threshold consecutive failures -> OPEN
      OPEN   -> recovery_timeout elapsed              -> HALF_OPEN
      HALF_OPEN -> success                            -> CLOSED
      HALF_OPEN -> failure                            -> OPEN
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        name: str = "unnamed",
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.name = name

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_at: Optional[float] = None

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if self._last_failure_at and (time.monotonic() - self._last_failure_at) >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                log.info("[circuit:%s] -> HALF_OPEN (probe allowed)", self.name)
        return self._state

    def _on_success(self) -> None:
        if self._state == CircuitState.HALF_OPEN:
            log.info("[circuit:%s] -> CLOSED (probe succeeded)", self.name)
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_at = None

    def _on_failure(self) -> None:
        self._failure_count += 1
        self._last_failure_at = time.monotonic()
        if self._state == CircuitState.HALF_OPEN or self._failure_count >= self.failure_threshold:
            log.warning(
                "[circuit:%s] -> OPEN (failures=%d threshold=%d)",
                self.name, self._failure_count, self.failure_threshold,
            )
            self._state = CircuitState.OPEN

    async def __aenter__(self):
        if self.state == CircuitState.OPEN:
            raise AdapterUnavailableError(
                f"Circuit breaker OPEN for '{self.name}' — exchange unavailable. "
                f"Will retry after {self.recovery_timeout:.0f}s."
            )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self._on_success()
        elif exc_type is not None and issubclass(exc_type, RETRIABLE_EXCEPTIONS):
            self._on_failure()
        return False

    def get_status(self) -> dict:
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self._failure_count,
            "failure_threshold": self.failure_threshold,
            "last_failure_at": self._last_failure_at,
            "recovery_timeout_s": self.recovery_timeout,
        }
