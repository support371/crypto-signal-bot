"""Earnings summary and history endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from backend.dependencies import require_auth
from backend.logic import rate_limit
from backend.logic.earnings import (
    get_history as earnings_get_history,
    get_summary as earnings_get_summary,
    reset_earnings,
)

router = APIRouter(dependencies=[Depends(rate_limit.rate_limit)])


@router.get("/earnings/summary")
def get_earnings_summary():
    return earnings_get_summary()


@router.get("/earnings/history")
def get_earnings_history(
    symbol: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    return {"trades": earnings_get_history(symbol=symbol, limit=limit)}


@router.post("/earnings/reset")
def reset_earnings_ledger(_: None = Depends(require_auth)):
    reset_earnings()
    return {"status": "ok", "message": "Earnings ledger cleared"}
