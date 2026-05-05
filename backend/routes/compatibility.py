"""
Command-centre compatibility endpoints.

These routes expose legacy command-centre API contracts while delegating to
handlers already defined in backend.app. Imports are intentionally lazy inside
route handlers to avoid startup-time circular imports when backend.app loads.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request


compatibility_router = APIRouter(prefix="/api", tags=["compatibility"])


def _rate_limit_dependency(request: Request) -> None:
    from backend.app import rate_limit

    return rate_limit(request)


@compatibility_router.get("/account/summary", dependencies=[Depends(_rate_limit_dependency)])
def account_summary() -> dict:
    """Return account balances and positions."""
    from backend.app import get_balance

    return get_balance()


@compatibility_router.get("/signals/recent", dependencies=[Depends(_rate_limit_dependency)])
def signals_recent(symbol: str = "BTCUSDT") -> dict:
    """Return the most recent signal for a symbol."""
    from backend.app import get_signal_latest

    result = get_signal_latest(symbol)
    return {
        "symbol": result.get("symbol"),
        "signal": result.get("signal"),
        "risk": result.get("risk"),
        "timestamp": result.get("timestamp"),
    }


@compatibility_router.get("/positions", dependencies=[Depends(_rate_limit_dependency)])
def positions() -> dict:
    """Return current positions."""
    from backend.app import get_positions

    return get_positions()


@compatibility_router.get("/guardian/status", dependencies=[Depends(_rate_limit_dependency)])
def guardian_status() -> dict:
    """Return guardian state."""
    from backend.app import get_guardian_status

    return get_guardian_status()


@compatibility_router.get("/equity/history", dependencies=[Depends(_rate_limit_dependency)])
def equity_history(symbol: Optional[str] = None, limit: int = 100) -> dict:
    """Return equity/P&L history."""
    from backend.app import earnings_get_history

    return earnings_get_history(symbol=symbol, limit=limit)
