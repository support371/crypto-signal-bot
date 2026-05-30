"""
Exchange API retry logic with exponential backoff.

Wraps exchange adapter calls with automatic retry for transient failures
(network timeouts, rate limits, temporary server errors). Non-retryable
errors (auth failures, insufficient balance) are raised immediately.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional, Set, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Errors that should NOT be retried (deterministic failures)
_NON_RETRYABLE_ERRORS: Set[str] = {
    "AuthenticationError",
    "InsufficientFunds",
    "InvalidOrder",
    "BadSymbol",
    "OrderNotFound",
    "PermissionDenied",
    "AccountSuspended",
}


def with_retry(
    fn: Callable[..., T],
    *args: Any,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    operation_name: Optional[str] = None,
    **kwargs: Any,
) -> T:
    """
    Execute a function with exponential backoff retry logic.

    Args:
        fn: The function to call
        max_retries: Maximum number of retry attempts (default: 3)
        base_delay: Initial delay in seconds (default: 1.0)
        max_delay: Maximum delay cap in seconds (default: 30.0)
        backoff_factor: Multiplier for each subsequent delay (default: 2.0)
        operation_name: Human-readable name for logging

    Returns:
        The return value of fn(*args, **kwargs)

    Raises:
        The last exception if all retries are exhausted, or immediately
        for non-retryable errors.
    """
    op = operation_name or getattr(fn, "__name__", "unknown")
    last_exception: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        try:
            result = fn(*args, **kwargs)
            if attempt > 0:
                logger.info(
                    "%s succeeded on attempt %d/%d",
                    op, attempt + 1, max_retries + 1,
                )
            return result

        except Exception as exc:
            last_exception = exc
            error_type = type(exc).__name__

            # Check if this error is non-retryable
            if error_type in _NON_RETRYABLE_ERRORS:
                logger.error(
                    "%s failed with non-retryable error: %s: %s",
                    op, error_type, exc,
                )
                raise

            if attempt < max_retries:
                delay = min(base_delay * (backoff_factor ** attempt), max_delay)
                logger.warning(
                    "%s failed (attempt %d/%d): %s: %s — retrying in %.1fs",
                    op, attempt + 1, max_retries + 1, error_type, exc, delay,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "%s failed after %d attempts: %s: %s",
                    op, max_retries + 1, error_type, exc,
                )

    raise last_exception  # type: ignore[misc]


class RetryableAdapter:
    """
    Wraps an ExchangeAdapter with retry logic for all exchange API calls.

    Non-retryable errors (auth failures, insufficient balance) pass through
    immediately. Transient errors (network, rate limit) are retried with
    exponential backoff.
    """

    def __init__(
        self,
        adapter: Any,
        max_retries: int = 3,
        base_delay: float = 1.0,
    ) -> None:
        self._adapter = adapter
        self._max_retries = max_retries
        self._base_delay = base_delay

    def place_order(self, **kwargs: Any) -> dict:
        return with_retry(
            self._adapter.place_order,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name=f"place_order({kwargs.get('symbol', '?')})",
            **kwargs,
        )

    def get_balance(self, asset: str = "USDT") -> float:
        return with_retry(
            self._adapter.get_balance,
            asset,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name=f"get_balance({asset})",
        )

    def get_price(self, symbol: str) -> float:
        return with_retry(
            self._adapter.get_price,
            symbol,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name=f"get_price({symbol})",
        )

    def get_order_status(self, order_id: str, symbol: str) -> dict:
        return with_retry(
            self._adapter.get_order_status,
            order_id, symbol,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name=f"get_order_status({order_id})",
        )

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        return with_retry(
            self._adapter.cancel_order,
            order_id, symbol,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name=f"cancel_order({order_id})",
        )

    def reconcile(self) -> dict:
        return with_retry(
            self._adapter.reconcile,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name="reconcile",
        )

    def liquidate_all_positions(self) -> dict:
        return with_retry(
            self._adapter.liquidate_all_positions,
            max_retries=self._max_retries,
            base_delay=self._base_delay,
            operation_name="liquidate_all_positions",
        )

    @property
    def mode(self) -> str:
        return self._adapter.mode

    @property
    def exchange(self) -> str:
        return self._adapter.exchange
