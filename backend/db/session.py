# backend/db/session.py
"""
PHASE 11 — Database session factory.

Creates and manages the AsyncEngine and AsyncSessionmaker.
Called once at application startup from main.py via startup_or_exit().

Supports:
  - PostgreSQL (production) via asyncpg
  - SQLite (staging/test) via aiosqlite

The session factory is the single access point to the database.
No competing truth stores.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.config.loader import get_database_config
from backend.db.models import Base

log = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _make_url(raw_url: str) -> str:
    """Convert sync DSN to async DSN if needed."""
    url = raw_url
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("sqlite:///"):
        url = url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    return url


async def init_db() -> None:
    """
    Initialise the database engine and create all tables.
    Called once at app startup.
    """
    global _engine, _session_factory

    cfg = get_database_config()
    url = _make_url(cfg.url)

    log.info("Initialising database: %s", url.split("@")[-1] if "@" in url else url)

    _engine = create_async_engine(
        url,
        echo=cfg.echo,
        pool_size=cfg.pool_size if "sqlite" not in url else 1,
        max_overflow=cfg.max_overflow if "sqlite" not in url else 0,
        pool_pre_ping=True,
    )

    _session_factory = async_sessionmaker(
        _engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )

    # Create tables (idempotent — safe in production for new tables)
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    log.info("Database initialised successfully.")


async def close_db() -> None:
    """Dispose the engine at app shutdown."""
    global _engine
    if _engine:
        await _engine.dispose()
        _engine = None
        log.info("Database connection closed.")


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Async context manager for database sessions.

    Usage:
        async with get_session() as session:
            repo = OrderRepository(session)
            await repo.save(order)
            await session.commit()
    """
    if _session_factory is None:
        raise RuntimeError("Database not initialised. Call init_db() at startup.")
    async with _session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# Alembic migration entry (alembic/env.py integration)
# ---------------------------------------------------------------------------
# To generate a migration:
#   alembic revision --autogenerate -m "describe change"
# To apply:
#   alembic upgrade head
#
# alembic.ini target_metadata should reference backend.db.models.Base.metadata
# ---------------------------------------------------------------------------
