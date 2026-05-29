# backend/db/models/__init__.py
"""
PHASE 11 — Database models.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase
from .utils import unix_timestamp


class Base(DeclarativeBase):
    pass


class OrderRecord(Base):
    """Every order submitted to an exchange adapter."""
    __tablename__ = "orders"

    id = Column(String(64), primary_key=True)
    symbol = Column(String(20), nullable=False, index=True)
    side = Column(String(8), nullable=False)             # BUY | SELL
    order_type = Column(String(16), nullable=False)            # MARKET | LIMIT
    quantity = Column(Float, nullable=False)
    price = Column(Float, nullable=True)                  # None for MARKET
    fill_price = Column(Float, nullable=True)
    filled_qty = Column(Float, default=0.0)
    status = Column(String(32), nullable=False, index=True) # FILLED | FAILED | RISK_REJECTED | PENDING
    mode = Column(String(8), nullable=False)             # paper | live
    venue = Column(String(32), nullable=False)            # exchange name
    exchange_order_id = Column(String(128), nullable=True)
    reject_reason = Column(Text, nullable=True)
    created_at = Column(BigInteger, default=unix_timestamp, index=True)
    updated_at = Column(BigInteger, default=unix_timestamp, onupdate=unix_timestamp)

    __table_args__ = (
        Index("ix_orders_symbol_created", "symbol", "created_at"),
        Index("ix_orders_status_created", "status", "created_at"),
    )


class FillRecord(Base):
    """Confirmed fills — one-to-one with FILLED orders."""
    __tablename__ = "fills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(64), nullable=False, index=True)
    symbol = Column(String(20), nullable=False)
    side = Column(String(8), nullable=False)
    quantity = Column(Float, nullable=False)
    fill_price = Column(Float, nullable=False)
    mode = Column(String(8), nullable=False)
    venue = Column(String(32), nullable=False)
    filled_at = Column(BigInteger, default=unix_timestamp, index=True)

    __table_args__ = (
        Index("ix_fills_symbol_filled_at", "symbol", "filled_at"),
    )


class PositionRecord(Base):
    """Open position lots — FIFO entries."""
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False, index=True)
    side = Column(String(8), nullable=False)
    quantity = Column(Float, nullable=False)
    cost_basis = Column(Float, nullable=False)
    mode = Column(String(8), nullable=False)
    order_id = Column(String(64), nullable=False)
    opened_at = Column(BigInteger, default=unix_timestamp)
    closed_at = Column(BigInteger, nullable=True)
    is_open = Column(Boolean, default=True, index=True)


class BalanceRecord(Base):
    """Balance snapshots — append-only time series."""
    __tablename__ = "balances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset = Column(String(20), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    mode = Column(String(8), nullable=False)
    source = Column(String(32), nullable=False)
    recorded_at = Column(BigInteger, default=unix_timestamp, index=True)


class GuardianEventRecord(Base):
    """All guardian triggers and state changes — append-only."""
    __tablename__ = "guardian_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(64), nullable=False, index=True)
    source = Column(String(32), nullable=False)
    reason = Column(Text, nullable=True)
    kill_switch_was = Column(Boolean, nullable=True)
    kill_switch_now = Column(Boolean, nullable=True)
    drawdown_pct = Column(Float, nullable=True)
    api_error_count = Column(Integer, nullable=True)
    created_at = Column(BigInteger, default=unix_timestamp, index=True)


class RiskEventRecord(Base):
    """Risk gate denials and approvals — append-only."""
    __tablename__ = "risk_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    intent_id = Column(String(64), nullable=True)
    symbol = Column(String(20), nullable=False)
    side = Column(String(8), nullable=False)
    risk_score = Column(Float, nullable=True)
    decision = Column(String(32), nullable=False)
    approved = Column(Boolean, nullable=False)
    reason = Column(Text, nullable=True)
    timestamp = Column(BigInteger, default=unix_timestamp, index=True)


class AuditLogRecord(Base):
    """Immutable audit trail for all system events."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(64), nullable=False, index=True)
    actor = Column(String(32), nullable=False)
    symbol = Column(String(20), nullable=True)
    side = Column(String(8), nullable=True)
    quantity = Column(Float, nullable=True)
    price = Column(Float, nullable=True)
    reason = Column(Text, nullable=True)
    order_id = Column(String(64), nullable=True)
    mode = Column(String(8), nullable=True)
    extra_json = Column(Text, nullable=True)
    timestamp = Column(BigInteger, default=unix_timestamp, index=True)

    __table_args__ = (
        Index("ix_audit_event_ts", "event_type", "timestamp"),
    )


class PortfolioStateRecord(Base):
    """Current portfolio balance per asset+mode — upserted on each trade."""
    __tablename__ = "portfolio_state"

    asset = Column(String(20), primary_key=True)
    mode = Column(String(8), primary_key=True, default="paper")
    amount = Column(Float, nullable=False)
    updated_at = Column(BigInteger, default=unix_timestamp, onupdate=unix_timestamp)


class ReconciliationReport(Base):
    """Periodic reconciliation snapshots."""
    __tablename__ = "reconciliation_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mode = Column(String(8), nullable=False)
    usdt_balance = Column(Float, nullable=False)
    total_realized_pnl = Column(Float, nullable=False)
    total_unrealized_pnl = Column(Float, nullable=True)
    open_lots_count = Column(Integer, default=0)
    trade_count = Column(Integer, default=0)
    discrepancy_detected = Column(Boolean, default=False)
    discrepancy_detail = Column(Text, nullable=True)
    created_at = Column(BigInteger, default=unix_timestamp, index=True)


class ServiceHeartbeat(Base):
    """Latest heartbeat per service — one row per service name."""
    __tablename__ = "service_heartbeats"

    service_name = Column(String(64), primary_key=True)
    last_beat_at = Column(BigInteger, nullable=False)
    status = Column(String(32), default="alive")
    detail = Column(Text, nullable=True)
    updated_at = Column(BigInteger, default=unix_timestamp, onupdate=unix_timestamp)


__all__ = [
    "Base",
    "unix_timestamp",
    "OrderRecord",
    "FillRecord",
    "PositionRecord",
    "BalanceRecord",
    "GuardianEventRecord",
    "RiskEventRecord",
    "AuditLogRecord",
    "PortfolioStateRecord",
    "ReconciliationReport",
    "ServiceHeartbeat",
]
