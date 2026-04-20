# backend/db/repositories/base.py
"""
PHASE 11 — Repository base and concrete repositories.

One authoritative persistence path for all runtime state.
All reads and writes go through these repositories — no competing stores.

Architecture:
  - AsyncSession from SQLAlchemy (asyncpg driver for PostgreSQL)
  - Each repository wraps one or more tables
  - Audit log writes are append-only (no update/delete methods on AuditLogRepository)
  - Phase 11 replaces the in-process buffers used in Phases 8–10

Session injection:
  The app factory creates an AsyncSessionmaker and passes it to each repo.
  This file provides the base class; the session factory is wired in main.py.
"""

from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Optional, Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import (
    AuditLogRecord,
    BalanceRecord,
    FillRecord,
    GuardianEventRecord,
    OrderRecord,
    PositionRecord,
    ReconciliationReport,
    RiskEventRecord,
    ServiceHeartbeat,
)


# ---------------------------------------------------------------------------
# Base repository
# ---------------------------------------------------------------------------

class BaseRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session


# ---------------------------------------------------------------------------
# Order repository
# ---------------------------------------------------------------------------

class OrderRepository(BaseRepository):
    async def save(self, record: OrderRecord) -> None:
        self.session.add(record)
        await self.session.flush()

    async def get_by_id(self, order_id: str) -> Optional[OrderRecord]:
        result = await self.session.execute(
            select(OrderRecord).where(OrderRecord.id == order_id)
        )
        return result.scalar_one_or_none()

    async def get_recent(self, limit: int = 50) -> Sequence[OrderRecord]:
        result = await self.session.execute(
            select(OrderRecord)
            .order_by(OrderRecord.created_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_symbol(self, symbol: str, limit: int = 20) -> Sequence[OrderRecord]:
        result = await self.session.execute(
            select(OrderRecord)
            .where(OrderRecord.symbol == symbol)
            .order_by(OrderRecord.created_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def update_status(
        self, order_id: str, status: str,
        fill_price: Optional[float] = None,
        filled_qty: Optional[float] = None,
    ) -> None:
        values: dict = {"status": status, "updated_at": int(time.time())}
        if fill_price is not None:
            values["fill_price"] = fill_price
        if filled_qty is not None:
            values["filled_qty"] = filled_qty
        await self.session.execute(
            update(OrderRecord)
            .where(OrderRecord.id == order_id)
            .values(**values)
        )


# ---------------------------------------------------------------------------
# Fill repository
# ---------------------------------------------------------------------------

class FillRepository(BaseRepository):
    async def save(self, record: FillRecord) -> None:
        self.session.add(record)
        await self.session.flush()

    async def get_by_symbol(self, symbol: str, limit: int = 50) -> Sequence[FillRecord]:
        result = await self.session.execute(
            select(FillRecord)
            .where(FillRecord.symbol == symbol)
            .order_by(FillRecord.filled_at.desc())
            .limit(limit)
        )
        return result.scalars().all()


# ---------------------------------------------------------------------------
# Position repository
# ---------------------------------------------------------------------------

class PositionRepository(BaseRepository):
    async def save(self, record: PositionRecord) -> None:
        self.session.add(record)
        await self.session.flush()

    async def get_open_positions(self) -> Sequence[PositionRecord]:
        result = await self.session.execute(
            select(PositionRecord)
            .where(PositionRecord.is_open == True)  # noqa: E712
            .order_by(PositionRecord.opened_at.asc())
        )
        return result.scalars().all()

    async def get_open_by_symbol(self, symbol: str) -> Sequence[PositionRecord]:
        result = await self.session.execute(
            select(PositionRecord)
            .where(
                PositionRecord.symbol == symbol,
                PositionRecord.is_open == True,  # noqa: E712
            )
            .order_by(PositionRecord.opened_at.asc())
        )
        return result.scalars().all()

    async def close_position(self, position_id: int, closed_at: Optional[int] = None) -> None:
        await self.session.execute(
            update(PositionRecord)
            .where(PositionRecord.id == position_id)
            .values(is_open=False, closed_at=closed_at or int(time.time()))
        )


# ---------------------------------------------------------------------------
# Balance repository
# ---------------------------------------------------------------------------

class BalanceRepository(BaseRepository):
    async def save(self, record: BalanceRecord) -> None:
        self.session.add(record)
        await self.session.flush()

    async def get_latest_balance(self, asset: str, mode: str) -> Optional[float]:
        result = await self.session.execute(
            select(BalanceRecord)
            .where(BalanceRecord.asset == asset, BalanceRecord.mode == mode)
            .order_by(BalanceRecord.recorded_at.desc())
            .limit(1)
        )
        record = result.scalar_one_or_none()
        return record.amount if record else None


# ---------------------------------------------------------------------------
# Audit log repository — APPEND ONLY
# ---------------------------------------------------------------------------

class AuditLogRepository(BaseRepository):
    """
    Audit log is strictly append-only.
    No update or delete methods are exposed here.
    """

    async def append(self, record: AuditLogRecord) -> None:
        self.session.add(record)
        await self.session.flush()

    async def get_recent(self, limit: int = 100) -> Sequence[AuditLogRecord]:
        result = await self.session.execute(
            select(AuditLogRecord)
            .order_by(AuditLogRecord.timestamp.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def get_by_event_type(
        self, event_type: str, limit: int = 50
    ) -> Sequence[AuditLogRecord]:
        result = await self.session.execute(
            select(AuditLogRecord)
            .where(AuditLogRecord.event_type == event_type)
            .order_by(AuditLogRecord.timestamp.desc())
            .limit(limit)
        )
        return result.scalars().all()


# ---------------------------------------------------------------------------
# Guardian event repository — append-only
# ---------------------------------------------------------------------------

class GuardianEventRepository(BaseRepository):
    async def append(self, record: GuardianEventRecord) -> None:
        self.session.add(record)
        await self.session.flush()

    async def get_recent(self, limit: int = 50) -> Sequence[GuardianEventRecord]:
        result = await self.session.execute(
            select(GuardianEventRecord)
            .order_by(GuardianEventRecord.created_at.desc())
            .limit(limit)
        )
        return result.scalars().all()


# ---------------------------------------------------------------------------
# Reconciliation repository
# ---------------------------------------------------------------------------

class ReconciliationRepository(BaseRepository):
    async def save(self, report: ReconciliationReport) -> None:
        self.session.add(report)
        await self.session.flush()

    async def get_latest(self) -> Optional[ReconciliationReport]:
        result = await self.session.execute(
            select(ReconciliationReport)
            .order_by(ReconciliationReport.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Service heartbeat repository
# ---------------------------------------------------------------------------

class HeartbeatRepository(BaseRepository):
    async def upsert(self, service_name: str, status: str = "alive", detail: Optional[str] = None) -> None:
        existing = await self.session.get(ServiceHeartbeat, service_name)
        now = int(time.time())
        if existing:
            existing.last_beat_at = now
            existing.status = status
            existing.detail = detail
            existing.updated_at = now
        else:
            self.session.add(ServiceHeartbeat(
                service_name=service_name,
                last_beat_at=now,
                status=status,
                detail=detail,
                updated_at=now,
            ))
        await self.session.flush()

    async def get_all(self) -> Sequence[ServiceHeartbeat]:
        result = await self.session.execute(select(ServiceHeartbeat))
        return result.scalars().all()
