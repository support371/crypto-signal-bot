"""Persistent execution request ledger for live-order idempotency."""

from __future__ import annotations

from sqlalchemy import BigInteger, Column, Index, String, Text

from backend.db.models import Base
from backend.db.models.utils import unix_timestamp


class ExecutionRequestRecord(Base):
    """One durable claim per client supplied idempotency key."""

    __tablename__ = "execution_requests"

    idempotency_key = Column(String(128), primary_key=True)
    request_hash = Column(String(64), nullable=False)
    operation_id = Column(String(64), nullable=False, unique=True, index=True)
    mode = Column(String(8), nullable=False)
    status = Column(String(32), nullable=False, index=True)
    intent_id = Column(String(64), nullable=True, index=True)
    exchange_order_id = Column(String(128), nullable=True)
    response_json = Column(Text, nullable=True)
    error_code = Column(String(64), nullable=True)
    created_at = Column(BigInteger, default=unix_timestamp, index=True)
    updated_at = Column(
        BigInteger,
        default=unix_timestamp,
        onupdate=unix_timestamp,
        index=True,
    )

    __table_args__ = (
        Index("ix_execution_requests_status_updated", "status", "updated_at"),
    )
