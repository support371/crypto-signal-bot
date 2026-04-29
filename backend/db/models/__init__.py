# backend/db/models.py
"""
PHASE 11 — Database models.

SQLAlchemy 2.0 declarative models for all authoritative persistence entities.
These are the production-oriented truth tables.

Relationship to protected files:
  - backend/models_core.py (protected) — application-level Pydantic models
  - backend/models/execution_intent.py (protected) — ExecutionIntent Pydantic model
  - This file: SQLAlchemy ORM tables (separate from protected models)

Design:
  - All tables are append-friendly (soft deletes via status, not hard deletes)
  - audit_log is strictly append-only (no UPDATE, no DELETE)
  - guardian_events and risk_events are append-only
  - timestamps are unix seconds (int) for consistency with the rest of the system
  - One persistence path — no competing truth stores (Rule 6)
"""

from __future__ import annotations

import time
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, Column, Float, Index, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

class OrderRecord(Base):
    """Every order submitted to an exchange adapter."""
    __tablename__ = "orders"

    id              = Column(String(64), primary_key=True)
    symbol          = Column(String(20), nullable=False, index=True)
    side            = Column(String(8), nullable=False)             # BUY | SELL
    order_type      = Column(String(16), nullable=False)            # MARKET | LIMIT
    quantity        = Column(Float, nullable=False)
    price           = Column(Float, nullable=True)                  # None for MARKET
    fill_price      = Column(Float, nullable=True)
    filled_qty      = Column(Float, default=0.0)
    status          = Column(String(32), nullable=False, index=True) # FILLED | FAILED | RISK_REJECTED | PENDING
    mode            = Column(String(8), nullable=False)             # paper | live
    venue           = Column(String(32), nullable=False)            # exchange name
    exchange_order_id = Column(String(128), nullable=True)
    reject_reason   = Column(Text, nullable=True)
    created_at      = Column(BigInteger, default=lambda: int(time.time()), index=True)
    updated_at      = Column(BigInteger, default=lambda: int(time.time()))

    __table_args__ = (
        Index("ix_orders_symbol_created", "symbol", "created_at"),
        Index("ix_orders_status_created", "status", "created_at"),
    )


# ---------------------------------------------------------------------------
# Fills (confirmed executions)
# ---------------------------------------------------------------------------

class FillRecord(Base):
    """Confirmed fills — one-to-one with FILLED orders."""
    __tablename__ = "fills"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    order_id    = Column(String(64), nullable=False, index=True)
    symbol      = Column(String(20), nullable=False)
    side        = Column(String(8), nullable=False)
    quantity    = Column(Float, nullable=False)
    fill_price  = Column(Float, nullable=False)
    mode        = Column(String(8), nullable=False)
    venue       = Column(String(32), nullable=False)
    filled_at   = Column(BigInteger, default=lambda: int(time.time()), index=True)

    __table_args__ = (
        Index("ix_fills_symbol_filled_at", "symbol", "filled_at"),
    )


# ---------------------------------------------------------------------------
# Positions (open lots)
# ---------------------------------------------------------------------------

class PositionRecord(Base):
    """Open position lots — FIFO entries."""
    __tablename__ = "positions"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    symbol      = Column(String(20), nullable=False, index=True)
    side        = Column(String(8), nullable=False)     # BUY (long lot) | SELL (short lot)
    quantity    = Column(Float, nullable=False)
    cost_basis  = Column(Float, nullable=False)         # price per unit
    mode        = Column(String(8), nullable=False)
    order_id    = Column(String(64), nullable=False)
    opened_at   = Column(BigInteger, default=lambda: int(time.time()))
    closed_at   = Column(BigInteger, nullable=True)     # None = open
    is_open     = Column(Boolean, default=True, index=True)


# ---------------------------------------------------------------------------
# Balances
# ---------------------------------------------------------------------------

class BalanceRecord(Base):
    """Balance snapshots — append-only time series."""
    __tablename__ = "balances"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    asset       = Column(String(20), nullable=False, index=True)
    amount      = Column(Float, nullable=False)
    mode        = Column(String(8), nullable=False)
    source      = Column(String(32), nullable=False)    # "fill" | "withdrawal" | "reset"
    recorded_at = Column(BigInteger, default=lambda: int(time.time()), index=True)


# ---------------------------------------------------------------------------
# Guardian events
# ---------------------------------------------------------------------------

class GuardianEventRecord(Base):
    """All guardian triggers and state changes — append-only."""
    __tablename__ = "guardian_events"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    event_type      = Column(String(64), nullable=False, index=True)
    # kill_switch_activated | kill_switch_deactivated | threshold_triggered | heartbeat_lost
    source          = Column(String(32), nullable=False)    # guardian_auto | operator_api | system
    reason          = Column(Text, nullable=True)
    kill_switch_was = Column(Boolean, nullable=True)        # state BEFORE event
    kill_switch_now = Column(Boolean, nullable=True)        # state AFTER event
    drawdown_pct    = Column(Float, nullable=True)
    api_error_count = Column(Integer, nullable=True)
    created_at      = Column(BigInteger, default=lambda: int(time.time()), index=True)


# ---------------------------------------------------------------------------
# Risk events
# ---------------------------------------------------------------------------

class RiskEventRecord(Base):
    """Risk gate denials and approvals — append-only."""
    __tablename__ = "risk_events"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    intent_id   = Column(String(64), nullable=True)
    symbol      = Column(String(20), nullable=False)
    side        = Column(String(8), nullable=False)
    risk_score  = Column(Float, nullable=True)
    decision    = Column(String(32), nullable=False)    # ENTER_LONG | HOLD | EXIT | RISK_REJECTED
    approved    = Column(Boolean, nullable=False)
    reason      = Column(Text, nullable=True)
    timestamp   = Column(BigInteger, default=lambda: int(time.time()), index=True)


# ---------------------------------------------------------------------------
# Audit log — strictly append-only (no UPDATE, no DELETE)
# ---------------------------------------------------------------------------

class AuditLogRecord(Base):
    """Immutable audit trail for all system events."""
    __tablename__ = "audit_log"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    event_type  = Column(String(64), nullable=False, index=True)
    actor       = Column(String(32), nullable=False)    # operator | guardian | system | engine
    symbol      = Column(String(20), nullable=True)
    side        = Column(String(8), nullable=True)
    quantity    = Column(Float, nullable=True)
    price       = Column(Float, nullable=True)
    reason      = Column(Text, nullable=True)
    order_id    = Column(String(64), nullable=True)
    mode        = Column(String(8), nullable=True)
    extra_json  = Column(Text, nullable=True)           # JSON-encoded extra fields
    timestamp   = Column(BigInteger, default=lambda: int(time.time()), index=True)

    __table_args__ = (
        Index("ix_audit_event_ts", "event_type", "timestamp"),
    )


# ---------------------------------------------------------------------------
# Reconciliation reports
# ---------------------------------------------------------------------------

class ReconciliationReport(Base):
    """Periodic reconciliation snapshots."""
    __tablename__ = "reconciliation_reports"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    mode                 = Column(String(8), nullable=False)
    usdt_balance         = Column(Float, nullable=False)
    total_realized_pnl   = Column(Float, nullable=False)
    total_unrealized_pnl = Column(Float, nullable=True)
    open_lots_count      = Column(Integer, default=0)
    trade_count          = Column(Integer, default=0)
    discrepancy_detected = Column(Boolean, default=False)
    discrepancy_detail   = Column(Text, nullable=True)
    created_at           = Column(BigInteger, default=lambda: int(time.time()), index=True)


# ---------------------------------------------------------------------------
# Service heartbeats
# ---------------------------------------------------------------------------

class ServiceHeartbeat(Base):
    """Latest heartbeat per service — one row per service name."""
    __tablename__ = "service_heartbeats"

    service_name = Column(String(64), primary_key=True)
    last_beat_at = Column(BigInteger, nullable=False)
    status       = Column(String(32), default="alive")  # alive | degraded | dead
    detail       = Column(Text, nullable=True)
    updated_at   = Column(BigInteger, default=lambda: int(time.time()))

    __table_args__ = (
        UniqueConstraint("service_name", name="uq_heartbeat_service"),
    )
