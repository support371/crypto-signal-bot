# backend/engine/broker_normalizer.py
"""
Broker normalizer.

Centralized conversion of BrokerAdapter output types
into repository-native (SQLAlchemy) record types.

This keeps conversion logic in one place so adapter changes
don't leak into repositories and routes.

Normalizes:
  - BrokerOrder       → BrokerOrderRecord
  - BrokerPosition    → BrokerPositionRecord
  - BrokerFill        → BrokerFillRecord
  - BrokerHealth      → BrokerHealthRecord
  - BrokerAccountInfo → dict (no DB model — used in route response only)

Rules:
  - No trading logic here
  - No route logic here
  - No external calls
  - Input types come from backend/adapters/brokers/base.py
  - Output types come from backend/db/models/broker_tables.py
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Optional

from backend.adapters.brokers.base import (
    BrokerAccountInfo,
    BrokerFill,
    BrokerHealth,
    BrokerOrder,
    BrokerPosition,
)
from backend.db.models.broker_tables import (
    BrokerFillRecord,
    BrokerHealthRecord,
    BrokerOrderRecord,
    BrokerPositionRecord,
)


def normalize_order(o: BrokerOrder) -> BrokerOrderRecord:
    return BrokerOrderRecord(
        venue             = o.venue,
        client_order_id   = o.client_order_id,
        broker_order_id   = o.broker_order_id,
        symbol            = o.symbol,
        broker_symbol     = o.broker_symbol,
        side              = o.side,
        order_type        = o.order_type,
        volume            = float(o.volume),
        requested_price   = float(o.requested_price) if o.requested_price else None,
        fill_price        = float(o.fill_price)       if o.fill_price       else None,
        sl                = float(o.sl)               if o.sl               else None,
        tp                = float(o.tp)               if o.tp               else None,
        status            = o.status,
        comment           = o.comment,
        magic_number      = o.magic_number,
        reason            = o.reason,
        created_at        = o.created_at,
        updated_at        = o.updated_at,
    )


def normalize_position(p: BrokerPosition) -> BrokerPositionRecord:
    return BrokerPositionRecord(
        venue           = p.venue,
        position_id     = p.position_id,
        symbol          = p.symbol,
        broker_symbol   = p.broker_symbol,
        side            = p.side,
        volume          = float(p.volume),
        entry_price     = float(p.entry_price),
        current_price   = float(p.current_price),
        sl              = float(p.sl) if p.sl else None,
        tp              = float(p.tp) if p.tp else None,
        unrealized_pnl  = float(p.unrealized_pnl),
        swap            = float(p.swap),
        comment         = p.comment,
        magic_number    = p.magic_number,
        is_open         = True,
        opened_at       = p.opened_at,
        updated_at      = p.updated_at,
    )


def normalize_fill(f: BrokerFill) -> BrokerFillRecord:
    return BrokerFillRecord(
        venue           = f.venue,
        fill_id         = f.fill_id,
        broker_order_id = f.broker_order_id,
        position_id     = f.position_id,
        symbol          = f.symbol,
        broker_symbol   = f.broker_symbol,
        side            = f.side,
        volume          = float(f.volume),
        price           = float(f.price),
        fee             = float(f.fee),
        realized_pnl    = float(f.realized_pnl),
        timestamp       = f.timestamp,
    )


def normalize_health(h: BrokerHealth) -> BrokerHealthRecord:
    return BrokerHealthRecord(
        venue               = h.venue,
        terminal_connected  = h.terminal_connected,
        broker_session_ok   = h.broker_session_ok,
        symbols_loaded      = h.symbols_loaded,
        order_path_ok       = h.order_path_ok,
        latency_ms          = h.latency_ms,
        last_error          = h.last_error,
        timestamp           = h.timestamp,
    )


def account_to_dict(a: BrokerAccountInfo) -> dict:
    """Route-safe dict representation of account info."""
    return {
        "venue":        a.venue,
        "login_id":     a.login_id,
        "server":       a.server,
        "equity":       float(a.equity),
        "balance":      float(a.balance),
        "margin":       float(a.margin),
        "free_margin":  float(a.free_margin),
        "margin_level": a.margin_level,
        "currency":     a.currency,
        "leverage":     a.leverage,
        "timestamp":    a.timestamp,
    }


def broker_fill_to_exchange_fill(
    broker_fill: BrokerFill,
) -> dict:
    """
    Converts a broker fill into the shape expected by engine/pnl.py process_fill().
    Allows MT5 fills to contribute to the unified P&L ledger.
    """
    return {
        "order_id":   broker_fill.broker_order_id,
        "symbol":     broker_fill.symbol,
        "side":       broker_fill.side,
        "quantity":   broker_fill.volume,
        "fill_price": broker_fill.price,
        "filled_at":  broker_fill.timestamp,
    }
