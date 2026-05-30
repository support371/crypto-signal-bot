# backend/services/exchange_retry.py
"""
Production exchange retry + circuit breaker wiring.

Provides:
  - with_retry(fn, max_retries, base_delay): sync retry with exponential backoff
  - RetryableAdapter: wraps any exchange adapter with transparent retry
  - get_circuit_breaker(name): per-exchange async circuit breaker registry
  - get_all_circuit_breaker_statuses(): observability endpoint data

Retry rules:
  - ConnectionError, TimeoutError, OSError: retriable (transient)
  - Any other exception type: NOT retried (permanent — auth, funds, logic errors)
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Dict, Optional, TypeVar

from backend.adapters.exchanges.retry import CircuitBreaker

log = logging.getLogger(__name__)

T = TypeVar("T")

# Retriable exception types for sync with_retry
_SYNC_RETRIABLE = (ConnectionError, TimeoutError, OSError)


def with_retry(
    fn: Callable[..., T],
    *args: Any,
    max_retries: int = 3,
    base_delay: float = 0.5,
    backoff_factor: float = 2.0,
    max_delay: float = 30.0,
    **kwargs: Any,
) -> T:
    """
    Synchronous retry with exponential backoff.

    Retries on ConnectionError, TimeoutError, OSError (transient failures).
    Any other exception type propagates immediately without retry.

    Args:
        fn: Callable to invoke.
        *args: Positional arguments for fn.
        max_retries: Max additional attempts after initial failure (total = max_retries + 1).
        base_delay: Seconds to wait before first retry.
        backoff_factor: Multiply delay by this on each retry.
        max_delay: Cap on retry delay seconds.
        **kwargs: Keyword arguments for fn.

    Returns:
        Result of fn(*args, **kwargs).

    Raises:
        The last exception if all attempts fail.
        Any non-retriable exception immediately.
    """
    last_exc: Optional[Exception] = None
    total_attempts = max_retries + 1

    for attempt in range(total_attempts):
        try:
            return fn(*args, **kwargs)
        except _SYNC_RETRIABLE as exc:
            last_exc = exc
            if attempt == total_attempts - 1:
                break  # exhausted
            delay = min(base_delay * (backoff_factor ** attempt), max_delay)
            log.warning(
                "[with_retry] %s attempt %d/%d failed: %s — retrying in %.2fs",
                getattr(fn, "__name__", repr(fn)),
                attempt + 1,
                total_attempts,
                exc,
                delay,
            )
            time.sleep(delay)
        except Exception:
            raise  # non-retriable — propagate immediately

    log.error(
        "[with_retry] %s failed after %d attempts: %s",
        getattr(fn, "__name__", repr(fn)),
        total_attempts,
        last_exc,
    )
    raise last_exc  # type: ignore[misc]


class RetryableAdapter:
    """
    Wraps any exchange adapter with transparent sync retry.

    Proxies all attribute access to the underlying adapter.
    Method calls are wrapped with with_retry() automatically.

    Usage:
        inner = build_adapter(...)
        adapter = RetryableAdapter(inner, max_retries=3, base_delay=0.5)
        price = adapter.get_price("BTCUSDT")   # retried on transient failure
    """

    def __init__(
        self,
        adapter: Any,
        max_retries: int = 3,
        base_delay: float = 0.5,
        backoff_factor: float = 2.0,
    ):
        # Use object.__setattr__ to avoid triggering our __getattr__
        object.__setattr__(self, "_adapter", adapter)
        object.__setattr__(self, "_max_retries", max_retries)
        object.__setattr__(self, "_base_delay", base_delay)
        object.__setattr__(self, "_backoff_factor", backoff_factor)

    def __getattr__(self, name: str) -> Any:
        """Proxy attribute access to the underlying adapter."""
        adapter = object.__getattribute__(self, "_adapter")
        attr = getattr(adapter, name)
        if callable(attr):
            max_retries = object.__getattribute__(self, "_max_retries")
            base_delay = object.__getattribute__(self, "_base_delay")
            backoff_factor = object.__getattribute__(self, "_backoff_factor")

            def wrapped(*args, **kwargs):
                return with_retry(
                    attr,
                    *args,
                    max_retries=max_retries,
                    base_delay=base_delay,
                    backoff_factor=backoff_factor,
                    **kwargs,
                )
            return wrapped
        return attr


# ---------------------------------------------------------------------------
# Async circuit breaker registry (used by async exchange adapters)
# ---------------------------------------------------------------------------

_breakers: Dict[str, CircuitBreaker] = {}


def get_circuit_breaker(exchange_name: str) -> CircuitBreaker:
    """Return (or create) the async circuit breaker for a given exchange."""
    if exchange_name not in _breakers:
        _breakers[exchange_name] = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60.0,
            name=exchange_name,
        )
    return _breakers[exchange_name]


def get_all_circuit_breaker_statuses() -> list[dict]:
    """Return status of all registered circuit breakers (for /exchange/circuit-breakers)."""
    return [cb.get_status() for cb in _breakers.values()]


async def notify_guardian_on_failure(exchange_name: str, error: str) -> None:
    """Increment guardian API error counter when an exchange call fails permanently."""
    try:
        from backend.services.guardian_bot.service import on_api_error
        await on_api_error()
        log.warning(
            "[exchange_retry] Guardian notified of API error on %s: %s",
            exchange_name, error,
        )
    except Exception as exc:
        log.error("[exchange_retry] Failed to notify guardian: %s", exc)
