# backend/db/models/broker_tables.py
"""
PHASE MT5 — Broker persistence tables.

Tables:
  - broker_orders
  - broker_positions
  - broker_fills
  - broker_health
  - broker_sessions

These models share the authoritative SQLAlchemy Base exported by backend.db.models
so migrations and metadata creation can discover every persistence table through
one registry.
"""

from __future__ import annotations
import time
from sqlalchemy import Boolean, Column, Float, Integer, BigInteger, String, Text

from backend.db.models import Base


class BrokerOrderRecord(Base):
    __tablename__ = "broker_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    venue = Column(String(32), nullable=False, index=True)
    client_order_id = Column(String(128), nullable=False, index=True)
    broker_order_id = Column(String(128), nullable=True)
    symbol = Column(String(32), nullable=False, index=True)
    broker_symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)
    order_type = Column(String(16), nullable=False)
    volume = Column(Float, nullable=False)
    requested_price = Column(Float, nullable=True)
    fill_price = Column(Float, nullable=True)
    sl = Column(Float, nullable=True)
    tp = Column(Float, nullable=True)
    status = Column(String(32), nullable=False, index=True)
    comment = Column(Text, nullable=True)
    magic_number = Column(Integer, default=0)
    reason = Column(Text, nullable=True)
    created_at = Column(BigInteger, default=unix_timestamp, index=True)
    updated_at = Column(BigInteger, default=unix_timestamp, onupdate=unix_timestamp)

    __table_args__ = (
        UniqueConstraint("venue", "client_order_id", name="uq_broker_orders_venue_client_order"),
    )


class BrokerPositionRecord(Base):
    __tablename__ = "broker_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    venue = Column(String(32), nullable=False, index=True)
    position_id = Column(String(128), nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    broker_symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)
    volume = Column(Float, nullable=False)
    entry_price = Column(Float, nullable=False)
    current_price = Column(Float, nullable=True)
    sl = Column(Float, nullable=True)
    tp = Column(Float, nullable=True)
    unrealized_pnl = Column(Float, default=0.0)
    swap = Column(Float, default=0.0)
    comment = Column(Text, nullable=True)
    magic_number = Column(Integer, default=0)
    is_open = Column(Boolean, default=True, index=True)
    opened_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, default=unix_timestamp, onupdate=unix_timestamp)
    closed_at = Column(BigInteger, nullable=True)


class BrokerFillRecord(Base):
    __tablename__ = "broker_fills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    venue = Column(String(32), nullable=False, index=True)
    fill_id = Column(String(128), nullable=False)
    broker_order_id = Column(String(128), nullable=False, index=True)
    position_id = Column(String(128), nullable=True)
    symbol = Column(String(32), nullable=False, index=True)
    broker_symbol = Column(String(32), nullable=False)
    side = Column(String(8), nullable=False)
    volume = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    fee = Column(Float, default=0.0)
    realized_pnl = Column(Float, default=0.0)
    timestamp = Column(BigInteger, default=unix_timestamp, index=True)


class BrokerHealthRecord(Base):
    __tablename__ = "broker_health"

    id = Column(Integer, primary_key=True, autoincrement=True)
    venue = Column(String(32), nullable=False, index=True)
    terminal_connected = Column(Boolean, default=False)
    broker_session_ok = Column(Boolean, default=False)
    symbols_loaded = Column(Boolean, default=False)
    order_path_ok = Column(Boolean, default=False)
    latency_ms = Column(Float, nullable=True)
    last_error = Column(Text, nullable=True)
    timestamp = Column(BigInteger, default=unix_timestamp, index=True)


class BrokerSessionRecord(Base):
    __tablename__ = "broker_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    venue = Column(String(32), nullable=False, index=True)
    login_id = Column(String(64), nullable=False)
    server = Column(String(128), nullable=False)
    connected = Column(Boolean, default=False)
    authorized = Column(Boolean, default=False)
    terminal_initialized = Column(Boolean, default=False)
    last_error_code = Column(Integer, nullable=True)
    last_error_message = Column(Text, nullable=True)
    last_seen_at = Column(BigInteger, default=unix_timestamp, onupdate=unix_timestamp, index=True)
