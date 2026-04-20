# backend/engine/routing.py
"""
PHASE 9 — Execution routing layer.

Responsibilities:
  - Venue selection: primary adapter first, failover to secondaries
  - Retry logic: up to MAX_ATTEMPTS with exponential backoff
  - Returns Order from adapter on success
  - Raises ExecutionFailed if all venues exhausted

Rules:
  - No simulated fills in live execution paths
  - Paper mode uses paper adapter (real prices, paper ledger)
  - Live mode submits to real exchange API

Protected files: none accessed here.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from backend.adapters.exchanges import get_adapter
from backend.adapters.exchanges.base import (
    AdapterAuthError,
    AdapterOrderError,
    AdapterRateLimitError,
    AdapterUnavailableError,
    BaseExchangeAdapter,
    Order,
)
from backend.config.loader import get_exchange_config

log = logging.getLogger(__name__)

MAX_ATTEMPTS    = 3
BASE_BACKOFF_S  = 0.5   # seconds; doubles each retry
MAX_BACKOFF_S   = 4.0


# ---------------------------------------------------------------------------
# Routing errors
# ---------------------------------------------------------------------------

class ExecutionFailed(Exception):
    """All execution venues failed. Order not submitted."""
    def __init__(self, reason: str, venue_errors: Optional[dict[str, str]] = None):
        self.reason = reason
        self.venue_errors = venue_errors or {}
        super().__init__(reason)


class ExecutionRejected(Exception):
    """Order rejected by the exchange (not a connectivity failure)."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


# ---------------------------------------------------------------------------
# Ordered adapter list (reuses Phase 5 / 6 pattern)
# ---------------------------------------------------------------------------

async def _get_ordered_adapters() -> list[BaseExchangeAdapter]:
    cfg = get_exchange_config()
    paper = cfg.mode == "paper"
    adapters: list[BaseExchangeAdapter] = [get_adapter(cfg)]

    from backend.adapters.exchanges.btcc    import BtccAdapter
    from backend.adapters.exchanges.binance import BinanceAdapter
    from backend.adapters.exchanges.bitget  import BitgetAdapter

    seen = {type(adapters[0])}

    if BtccAdapter not in seen and (cfg.btcc_api_key or paper):
        adapters.append(BtccAdapter(
            api_key=cfg.btcc_api_key, api_secret=cfg.btcc_api_secret,
            paper=paper, base_url=cfg.btcc_base_url
        ))
        seen.add(BtccAdapter)

    if BinanceAdapter not in seen and (cfg.binance_api_key or paper):
        adapters.append(BinanceAdapter(
            api_key=cfg.binance_api_key, api_secret=cfg.binance_api_secret,
            paper=paper, base_url=cfg.binance_base_url, testnet=cfg.binance_testnet
        ))
        seen.add(BinanceAdapter)

    if BitgetAdapter not in seen and (cfg.bitget_api_key or paper):
        adapters.append(BitgetAdapter(
            api_key=cfg.bitget_api_key, api_secret=cfg.bitget_api_secret,
            passphrase=cfg.bitget_passphrase, paper=paper, base_url=cfg.bitget_base_url
        ))
        seen.add(BitgetAdapter)

    return adapters


# ---------------------------------------------------------------------------
# Core routing function
# ---------------------------------------------------------------------------

@dataclass
class RoutedOrder:
    order:        Order
    venue:        str   # exchange name that accepted the order
    attempts:     int
    elapsed_ms:   int


async def route_order(
    symbol:     str,
    side:       str,
    order_type: str,
    quantity:   Decimal,
    price:      Optional[Decimal] = None,
) -> RoutedOrder:
    """
    Route an order through the ordered adapter list.

    Retry strategy per adapter:
      - Attempt up to MAX_ATTEMPTS on transient errors (rate limit, unavailable)
      - No retry on hard rejections (auth error, order rejected by exchange)
      - Failover to next adapter after all retries exhausted

    Returns RoutedOrder on first successful fill.
    Raises ExecutionFailed if all venues are exhausted.
    Raises ExecutionRejected if the exchange hard-rejects the order.
    """
    adapters = await _get_ordered_adapters()
    venue_errors: dict[str, str] = {}
    t0 = int(time.time() * 1000)
    total_attempts = 0

    for adapter in adapters:
        backoff = BASE_BACKOFF_S
        for attempt in range(1, MAX_ATTEMPTS + 1):
            total_attempts += 1
            try:
                log.info(
                    "Routing %s %s %s qty=%s → %s (attempt %d/%d)",
                    order_type, side, symbol, quantity,
                    adapter.exchange_name, attempt, MAX_ATTEMPTS,
                )
                order = await adapter.create_order(
                    symbol=symbol,
                    side=side,
                    order_type=order_type,
                    quantity=quantity,
                    price=price,
                )
                elapsed = int(time.time() * 1000) - t0
                log.info(
                    "Order routed via %s in %dms — status=%s fill_price=%s",
                    adapter.exchange_name, elapsed, order.status, order.fill_price,
                )
                return RoutedOrder(
                    order=order,
                    venue=adapter.exchange_name,
                    attempts=total_attempts,
                    elapsed_ms=elapsed,
                )

            except AdapterAuthError as exc:
                # Hard failure — don't retry on this adapter
                log.error("Auth error on %s: %s — skipping adapter", adapter.exchange_name, exc)
                venue_errors[adapter.exchange_name] = f"auth: {exc}"
                break

            except AdapterOrderError as exc:
                # Exchange rejected the order — don't retry or failover
                raise ExecutionRejected(f"Order rejected by {adapter.exchange_name}: {exc}") from exc

            except (AdapterUnavailableError, AdapterRateLimitError) as exc:
                venue_errors[adapter.exchange_name] = str(exc)
                if attempt < MAX_ATTEMPTS:
                    log.warning(
                        "%s transient error (attempt %d/%d): %s — retrying in %.1fs",
                        adapter.exchange_name, attempt, MAX_ATTEMPTS, exc, backoff,
                    )
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, MAX_BACKOFF_S)
                else:
                    log.warning(
                        "%s exhausted retries: %s — failing over",
                        adapter.exchange_name, exc,
                    )

            except Exception as exc:
                venue_errors[adapter.exchange_name] = f"unexpected: {exc}"
                log.error("Unexpected routing error on %s: %s", adapter.exchange_name, exc)
                break

    raise ExecutionFailed(
        f"All venues failed for {side} {symbol}: {venue_errors}",
        venue_errors=venue_errors,
    )


async def cancel_order_via_routing(symbol: str, order_id: str) -> Order:
    """Cancel an order through the primary adapter."""
    cfg = get_exchange_config()
    adapter = get_adapter(cfg)
    try:
        return await adapter.cancel_order(symbol=symbol, order_id=order_id)
    except Exception as exc:
        raise ExecutionFailed(f"Cancel failed for {order_id}: {exc}") from exc


async def fetch_order_via_routing(symbol: str, order_id: str) -> Order:
    """Fetch current order state through the primary adapter."""
    cfg = get_exchange_config()
    adapter = get_adapter(cfg)
    return await adapter.fetch_order(symbol=symbol, order_id=order_id)
