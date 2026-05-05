from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request


compatibility_router = APIRouter(prefix="/api", tags=["compatibility"])


def _rate_limit_dependency(request: Request) -> None:
    from backend.app import rate_limit
    return rate_limit(request)


@compatibility_router.get("/account/summary", dependencies=[Depends(_rate_limit_dependency)])
def account_summary() -> dict:
    from backend.app import get_balance
    return get_balance()


@compatibility_router.get("/signals/recent", dependencies=[Depends(_rate_limit_dependency)])
def signals_recent(symbol: str = "BTCUSDT") -> dict:
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
    from backend.app import get_positions
    return get_positions()


@compatibility_router.get("/guardian/status", dependencies=[Depends(_rate_limit_dependency)])
def guardian_status() -> dict:
    from backend.app import get_guardian_status
    return get_guardian_status()


@compatibility_router.get("/equity/history", dependencies=[Depends(_rate_limit_dependency)])
def equity_history(symbol: Optional[str] = None, limit: int = 100) -> dict:
    from backend.app import earnings_get_history
    return {"trades": earnings_get_history(symbol=symbol, limit=limit)}
