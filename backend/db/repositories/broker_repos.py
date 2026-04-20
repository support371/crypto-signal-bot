# backend/db/repositories/broker_repos.py
"""Broker repositories — typed data access for broker tables."""

from __future__ import annotations
import time
from typing import Optional, Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models.broker_tables import (
    BrokerOrderRecord, BrokerPositionRecord,
    BrokerFillRecord, BrokerHealthRecord, BrokerSessionRecord,
)


class BrokerOrderRepository:
    def __init__(self, session: AsyncSession): self.session = session

    async def save(self, r: BrokerOrderRecord) -> None:
        self.session.add(r); await self.session.flush()

    async def get_by_venue(self, venue: str, limit: int = 100) -> Sequence[BrokerOrderRecord]:
        res = await self.session.execute(
            select(BrokerOrderRecord)
            .where(BrokerOrderRecord.venue == venue)
            .order_by(BrokerOrderRecord.created_at.desc()).limit(limit)
        )
        return res.scalars().all()

    async def update_status(self, client_order_id: str, status: str,
                            fill_price: Optional[float] = None) -> None:
        vals = {"status": status, "updated_at": int(time.time())}
        if fill_price is not None: vals["fill_price"] = fill_price
        await self.session.execute(
            update(BrokerOrderRecord)
            .where(BrokerOrderRecord.client_order_id == client_order_id)
            .values(**vals)
        )


class BrokerPositionRepository:
    def __init__(self, session: AsyncSession): self.session = session

    async def save(self, r: BrokerPositionRecord) -> None:
        self.session.add(r); await self.session.flush()

    async def get_open(self, venue: str) -> Sequence[BrokerPositionRecord]:
        res = await self.session.execute(
            select(BrokerPositionRecord)
            .where(BrokerPositionRecord.venue == venue,
                   BrokerPositionRecord.is_open == True)  # noqa: E712
            .order_by(BrokerPositionRecord.opened_at.asc())
        )
        return res.scalars().all()

    async def close(self, position_id: str, venue: str) -> None:
        await self.session.execute(
            update(BrokerPositionRecord)
            .where(BrokerPositionRecord.position_id == position_id,
                   BrokerPositionRecord.venue == venue)
            .values(is_open=False, closed_at=int(time.time()),
                    updated_at=int(time.time()))
        )


class BrokerFillRepository:
    def __init__(self, session: AsyncSession): self.session = session

    async def save(self, r: BrokerFillRecord) -> None:
        self.session.add(r); await self.session.flush()

    async def get_by_venue(self, venue: str, limit: int = 50) -> Sequence[BrokerFillRecord]:
        res = await self.session.execute(
            select(BrokerFillRecord)
            .where(BrokerFillRecord.venue == venue)
            .order_by(BrokerFillRecord.timestamp.desc()).limit(limit)
        )
        return res.scalars().all()


class BrokerHealthRepository:
    def __init__(self, session: AsyncSession): self.session = session

    async def save(self, r: BrokerHealthRecord) -> None:
        self.session.add(r); await self.session.flush()

    async def get_latest(self, venue: str) -> Optional[BrokerHealthRecord]:
        res = await self.session.execute(
            select(BrokerHealthRecord)
            .where(BrokerHealthRecord.venue == venue)
            .order_by(BrokerHealthRecord.timestamp.desc()).limit(1)
        )
        return res.scalar_one_or_none()


# backend/ws/broker_updates.py
# WebSocket broadcaster helpers for broker events

import json
import logging

_log = logging.getLogger(__name__)


async def _get_redis():
    try:
        import aioredis  # type: ignore
        from backend.config.loader import get_redis_config
        cfg = get_redis_config()
        return await aioredis.from_url(cfg.url, decode_responses=True)
    except Exception:
        return None


async def broadcast_broker_health(venue: str, health: dict) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.publish("broker_updates", json.dumps({
                "type": "broker_health", "venue": venue, **health
            }))
        except Exception as exc:
            _log.debug("broker_health broadcast failed: %s", exc)


async def broadcast_position_update(venue: str, position: dict) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.publish("broker_updates", json.dumps({
                "type": "position_update", "venue": venue, **position
            }))
        except Exception as exc:
            _log.debug("position_update broadcast failed: %s", exc)


async def broadcast_order_update(venue: str, order: dict) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.publish("broker_updates", json.dumps({
                "type": "order_update", "venue": venue, **order
            }))
        except Exception as exc:
            _log.debug("order_update broadcast failed: %s", exc)


async def broadcast_fill_update(venue: str, fill: dict) -> None:
    r = await _get_redis()
    if r:
        try:
            await r.publish("broker_updates", json.dumps({
                "type": "fill_update", "venue": venue, **fill
            }))
        except Exception as exc:
            _log.debug("fill_update broadcast failed: %s", exc)
