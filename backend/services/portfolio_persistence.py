"""
Portfolio persistence service.

Saves and restores PaperPortfolio balances to/from the database so that
portfolio state survives server restarts.

Usage:
    await restore_portfolio(portfolio)   # call at startup after init_db()
    await persist_portfolio(portfolio)   # call after each trade
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from backend.db.session import get_session
from backend.db.repositories.base import PortfolioRepository

if TYPE_CHECKING:
    from backend.logic.paper_trading import PaperPortfolio

log = logging.getLogger(__name__)


async def restore_portfolio(portfolio: "PaperPortfolio", mode: str = "paper") -> bool:
    """
    Load portfolio balances from the database into the in-memory portfolio.

    Returns True if balances were restored, False if no saved state was found
    (fresh start — portfolio keeps its default USDT balance).
    """
    try:
        async with get_session() as session:
            repo = PortfolioRepository(session)
            balances = await repo.load_balances(mode=mode)
            if balances:
                portfolio.balances = balances
                log.info(
                    "Restored portfolio from DB: %d assets, USDT=%.2f",
                    len(balances),
                    balances.get("USDT", 0.0),
                )
                return True
            log.info("No saved portfolio state — starting fresh.")
            return False
    except Exception:
        log.exception("Failed to restore portfolio from DB — starting fresh.")
        return False


async def persist_portfolio(portfolio: "PaperPortfolio", mode: str = "paper") -> None:
    """Save current portfolio balances to the database."""
    try:
        async with get_session() as session:
            repo = PortfolioRepository(session)
            await repo.save_balances(dict(portfolio.balances), mode=mode)
            await session.commit()
    except Exception:
        log.exception("Failed to persist portfolio to DB.")


async def persist_order(intent_dict: dict, mode: str = "paper") -> None:
    """Persist a filled/rejected order to the orders table."""
    from backend.db.models import OrderRecord
    try:
        async with get_session() as session:
            record = OrderRecord(
                id=intent_dict.get("id", ""),
                symbol=intent_dict.get("symbol", ""),
                side=intent_dict.get("side", ""),
                order_type=intent_dict.get("order_type", "MARKET"),
                quantity=intent_dict.get("quantity", 0.0),
                price=intent_dict.get("price"),
                fill_price=intent_dict.get("fill_price"),
                filled_qty=intent_dict.get("fill_quantity"),
                status=intent_dict.get("status", ""),
                mode=mode,
                venue=intent_dict.get("venue_id", "paper"),
                reject_reason=intent_dict.get("notes") if intent_dict.get("status") != "FILLED" else None,
            )
            session.add(record)
            await session.commit()
    except Exception:
        log.exception("Failed to persist order to DB.")
