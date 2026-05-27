from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, Depends, Request

compatibility_router = APIRouter(prefix="/api", tags=["compatibility"])


@compatibility_router.get("/account/summary")
def account_summary() -> dict:
    return {}


@compatibility_router.get("/signals/recent")
def signals_recent(symbol: str = "BTCUSDT") -> dict:
    return {}


@compatibility_router.get("/positions")
def positions() -> dict:
    return {}


@compatibility_router.get("/guardian/status")
def guardian_status() -> dict:
    return {}


@compatibility_router.get("/equity/history")
def equity_history(symbol: Optional[str] = None, limit: int = 100) -> dict:
    return {"trades": []}
