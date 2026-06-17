# backend/routes/signals_v1.py
"""
GET /api/v1/signals/public   — latest signals for every tracked symbol
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
    evaluate_signal,
)

router = APIRouter(prefix="/api/v1/signals", tags=["signals_v1"])

_ALLOWED_STRATEGIES = {"ema_crossover", "rsi_mean_revert", "macd_momentum", "combined"}


class SignalOut(BaseModel):
    id: str
    symbol: str
    timeframe: str
    side: str
    entry_price: float
    stop_loss: Optional[float]
    take_profit: Optional[float]
    confidence: float
    strategy_id: str
    created_at: int
    valid_until: int
    metadata: Dict[str, Any]


class SignalStatusOut(BaseModel):
    running: bool
    cached_symbols: List[str]
    tracked_symbols: int
    eval_interval: int
    last_eval: Dict[str, int]


def _normalize_strategy(strategy: Optional[str]) -> str:
    requested = (strategy or "ema_crossover").strip().lower()
    aliases = {
        "ema": "ema_crossover",
        "trend": "ema_crossover",
        "trend_follow": "ema_crossover",
        "rsi": "rsi_mean_revert",
        "mean_reversion": "rsi_mean_revert",
        "macd": "macd_momentum",
        "momentum": "macd_momentum",
    }
    requested = aliases.get(requested, requested)
    if requested not in _ALLOWED_STRATEGIES:
        return "ema_crossover"
    return requested


def _to_out(rec) -> SignalOut:
    return SignalOut(
        id=rec.id,
        symbol=rec.symbol,
        timeframe=rec.timeframe,
        side=rec.side,
        entry_price=rec.entry_price,
        stop_loss=rec.stop_loss,
        take_profit=rec.take_profit,
        confidence=rec.confidence,
        strategy_id=rec.strategy_id,
        created_at=rec.created_at,
        valid_until=rec.valid_until,
        metadata=rec.metadata,
    )


@router.get(
    "/public",
    response_model=List[SignalOut],
    summary="Latest signals for all tracked symbols",
)
async def signals_public() -> List[SignalOut]:
    return [_to_out(r) for r in get_all_cached_signals()]


@router.get(
    "/status",
    response_model=SignalStatusOut,
    summary="Signal service health",
)
async def signals_status() -> SignalStatusOut:
    return SignalStatusOut(**get_signal_service_status())


@router.get(
    "/{symbol}",
    response_model=SignalOut,
    summary="Latest signal for a specific symbol",
)
async def signal_for_symbol(symbol: str) -> SignalOut:
    rec = get_cached_signal(symbol.upper())
    if rec is None:
        raise HTTPException(status_code=404, detail=f"No signal cached for {symbol.upper()}")
    return _to_out(rec)


class EvaluateRequest(BaseModel):
    symbol: str
    timeframe: str = "1h"
    strategy: Optional[str] = None


@router.post(
    "/evaluate",
    response_model=SignalOut,
    summary="On-demand signal evaluation for a symbol",
)
async def evaluate_symbol_now(req: EvaluateRequest) -> SignalOut:
    """
    Force an immediate paper-safe signal evaluation for the requested symbol,
    bypassing the background eval loop cache. The optional strategy parameter is
    accepted for GPT Actions and recorded in metadata for routing/selection.
    Supported values: ema_crossover, rsi_mean_revert, macd_momentum, combined.
    """
    symbol = req.symbol.upper()
    strategy = _normalize_strategy(req.strategy)
    try:
        rec = await evaluate_signal(symbol, strategy=strategy)
    except TypeError as exc:
        if "strategy" not in str(exc):
            raise HTTPException(status_code=500, detail=str(exc))
        rec = await evaluate_signal(symbol)
        rec.metadata = dict(rec.metadata or {})
        rec.metadata["requested_strategy"] = strategy
        rec.metadata["strategy_parameter_supported"] = False
        rec.metadata["strategy_engine_note"] = "core engine used existing combined evaluator"
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    rec.metadata = dict(rec.metadata or {})
    rec.metadata.setdefault("requested_strategy", strategy)
    rec.metadata.setdefault("strategy_parameter_supported", True)
    return _to_out(rec)
