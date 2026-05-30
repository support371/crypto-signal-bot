# backend/routes/signals_v1.py
"""
GET /api/v1/signals/public   — latest signal for every tracked symbol
GET /api/v1/signals/{symbol} — latest signal for one symbol
GET /api/v1/signals/status   — signal service health
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.signal_service.service import (
    get_all_cached_signals,
    get_cached_signal,
    get_signal_service_status,
)

router = APIRouter(prefix="/api/v1/signals", tags=["signals_v1"])


class SignalOut(BaseModel):
    id:           str
    symbol:       str
    timeframe:    str
    side:         str
    entry_price:  float
    stop_loss:    Optional[float]
    take_profit:  Optional[float]
    confidence:   float
    strategy_id:  str
    created_at:   int
    valid_until:  int
    metadata:     Dict[str, Any]


class SignalStatusOut(BaseModel):
    running:          bool
    cached_symbols:   List[str]
    tracked_symbols:  int
    eval_interval:    int
    last_eval:        Dict[str, int]


def _to_out(rec) -> SignalOut:
    return SignalOut(
        id=rec.id, symbol=rec.symbol, timeframe=rec.timeframe,
        side=rec.side, entry_price=rec.entry_price,
        stop_loss=rec.stop_loss, take_profit=rec.take_profit,
        confidence=rec.confidence, strategy_id=rec.strategy_id,
        created_at=rec.created_at, valid_until=rec.valid_until,
        metadata=rec.metadata,
    )


@router.get("/public", response_model=List[SignalOut],
            summary="Latest signals for all tracked symbols")
async def signals_public() -> List[SignalOut]:
    return [_to_out(r) for r in get_all_cached_signals()]


@router.get("/status", response_model=SignalStatusOut,
            summary="Signal service health")
async def signals_status() -> SignalStatusOut:
    return SignalStatusOut(**get_signal_service_status())


@router.get("/{symbol}", response_model=SignalOut,
            summary="Latest signal for a specific symbol")
async def signal_for_symbol(symbol: str) -> SignalOut:
    rec = get_cached_signal(symbol.upper())
    if rec is None:
        raise HTTPException(status_code=404, detail=f"No signal cached for {symbol.upper()}")
    return _to_out(rec)
