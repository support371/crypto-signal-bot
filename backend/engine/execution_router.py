# backend/engine/execution_router.py
"""
Execution router — extends existing routing.py to support MT5 venue.

This module wraps the existing route_order() from routing.py and adds
MT5 broker venue selection. The existing exchange routing path is unchanged.

Routing decision:
  1. If intent specifies venue="mt5" and MT5 is available → use MT5
  2. If intent specifies venue="exchange" → use existing exchange adapters
  3. If no venue specified → default to exchange adapters
  4. All paths check kill switch + risk gate (enforced by coordinator.py)

Rules:
  - No direct broker calls outside adapter boundary
  - No guardian bypass
  - MT5 result normalized into same ExecutionResult shape as exchange orders
  - Failure from MT5 counted as failed_order for guardian (same as exchange failure)
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Optional

from backend.adapters.brokers.exceptions import (
    BrokerAuthError,
    BrokerOrderError,
    BrokerUnavailableError,
)
from backend.engine.routing import (
    ExecutionFailed,
    ExecutionRejected,
    RoutedOrder,
    route_order,
)
from backend.engine.venue_registry import get_venue, is_available
from backend.adapters.exchanges.base import Order

log = logging.getLogger(__name__)

VENUE_MT5      = "mt5"
VENUE_EXCHANGE = "exchange"


class BrokerRoutedOrder:
    """Result from a broker venue order — normalized to match RoutedOrder shape."""
    def __init__(self, broker_order, venue: str, attempts: int, elapsed_ms: int):
        self.broker_order = broker_order
        self.venue        = venue
        self.attempts     = attempts
        self.elapsed_ms   = elapsed_ms

        # Normalize to exchange Order shape for coordinator compatibility
        from backend.adapters.exchanges.base import Order as ExOrder
        self.order = ExOrder(
            id=broker_order.broker_order_id,
            symbol=broker_order.symbol,
            side=broker_order.side,
            order_type=broker_order.order_type,
            quantity=broker_order.volume,
            price=Decimal(str(broker_order.requested_price)) if broker_order.requested_price else None,
            fill_price=Decimal(str(broker_order.fill_price)) if broker_order.fill_price else None,
            filled_qty=broker_order.volume if broker_order.status == "FILLED" else Decimal("0"),
            status=broker_order.status,
            created_at=broker_order.created_at,
            updated_at=broker_order.updated_at,
            exchange_order_id=broker_order.broker_order_id,
        )


async def route_to_venue(
    symbol:     str,
    side:       str,
    order_type: str,
    quantity:   Decimal,
    price:      Optional[Decimal] = None,
    venue:      Optional[str]     = None,
    sl:         Optional[Decimal] = None,
    tp:         Optional[Decimal] = None,
    magic_number: int             = 0,
    comment:    str               = "",
) -> RoutedOrder | BrokerRoutedOrder:
    """
    Route an order to the appropriate venue.

    Returns RoutedOrder (exchange) or BrokerRoutedOrder (broker).
    Both have an .order attribute compatible with coordinator.py.

    Raises ExecutionFailed or ExecutionRejected on all venue failures.
    """
    t0 = int(time.time() * 1000)

    # MT5 venue
    if venue == VENUE_MT5:
        if not is_available(VENUE_MT5):
            raise ExecutionFailed(
                "MT5 venue is not available or not connected.",
                venue_errors={"mt5": "not connected"},
            )
        info = get_venue(VENUE_MT5)
        adapter = info.adapter  # MT5BrokerAdapter

        if not adapter.supports_symbol(symbol):
            raise ExecutionFailed(
                f"MT5 does not support symbol: {symbol}",
                venue_errors={"mt5": f"symbol {symbol} not mapped"},
            )

        try:
            broker_order = await adapter.submit_order(
                internal_symbol=symbol,
                side=side,
                order_type=order_type,
                volume=quantity,
                price=price,
                sl=sl,
                tp=tp,
                comment=comment,
                magic_number=magic_number,
            )
            elapsed = int(time.time() * 1000) - t0
            log.info(
                "MT5 order submitted: %s %s %s qty=%s elapsed=%dms",
                side, symbol, order_type, quantity, elapsed,
            )
            return BrokerRoutedOrder(
                broker_order=broker_order,
                venue=VENUE_MT5,
                attempts=1,
                elapsed_ms=elapsed,
            )

        except BrokerOrderError as exc:
            raise ExecutionRejected(f"MT5 rejected order: {exc}") from exc
        except (BrokerUnavailableError, BrokerAuthError) as exc:
            raise ExecutionFailed(
                f"MT5 venue failed: {exc}",
                venue_errors={"mt5": str(exc)},
            ) from exc

    # Default: exchange adapters (existing path in routing.py)
    return await route_order(
        symbol=symbol, side=side,
        order_type=order_type, quantity=quantity,
        price=price,
    )
