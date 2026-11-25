# backend/routes/signal.py
"""
Signal routes — prediction service-backed.

GET /signal/latest — runtime-backed by prediction service.
                     Never returns mock/synthetic signal state.

Signal unavailable state (available=False) is explicit and
actionable — the frontend treats it as "engine offline", not as
a trading signal.

Backward compatibility: includes `side` field mapping direction
to BUY/SELL/NEUTRAL for older frontend clients, and falls back
to market_state cache when prediction service has no data.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional

from backend.services.prediction_bot.service import (
    get_latest_signal,
    get_prediction_status,
)

router = APIRouter(tags=["signals"])

_DIRECTION_TO_SIDE = {"UP": "BUY", "DOWN": "SELL", "NEUTRAL": "NEUTRAL"}


class SignalResponse(BaseModel):
    symbol:     str
    direction:  str       # "UP" | "DOWN" | "NEUTRAL"
    side:       str       # "BUY" | "SELL" | "NEUTRAL" (backward compat)
    confidence: float
    regime:     str       # "TREND" | "RANGE" | "CHAOS"
    horizon:    int
    available:  bool      # False = engine offline, not a valid signal
    source:     str       # "signal_engine" | "unavailable" | "engine_error"
    computed_at: int
    reasoning:  Optional[str] = None
    message:    Optional[str] = None


class PredictionStatusResponse(BaseModel):
    running:          bool
    cached_symbols:   list[str]
    tracked_symbols:  int


@router.get(
    "/signal/latest",
    response_model=SignalResponse,
    summary="Latest runtime signal for a symbol",
    description=(
        "Returns the most recently computed signal from the prediction service. "
        "available=False means the engine is offline — not a trading signal. "
        "Never returns mock or synthetic signal state."
    ),
)
async def get_signal_latest(
    symbol: Optional[str] = Query(None, description="Backend symbol, e.g. BTCUSDT"),
) -> SignalResponse:
    if not symbol:
        return SignalResponse(
            symbol="",
            direction="NEUTRAL",
            side="NEUTRAL",
            confidence=0.0,
            regime="CHAOS",
            horizon=0,
            available=False,
            source="unavailable",
            computed_at=0,
            reasoning=None,
            message="Symbol parameter required. Use /signal/latest?symbol=BTCUSDT",
        )

    symbol = symbol.strip().upper()
    sig = await get_latest_signal(symbol)
    direction = sig.direction or "NEUTRAL"
    return SignalResponse(
        symbol=sig.symbol or symbol,
        direction=direction,
        side=_DIRECTION_TO_SIDE.get(direction, "NEUTRAL"),
        confidence=sig.confidence,
        regime=sig.regime,
        horizon=sig.horizon,
        available=sig.available,
        source=sig.source,
        computed_at=sig.computed_at,
        reasoning=sig.reasoning,
        message=sig.reasoning if not sig.available else None,
    )


@router.get(
    "/prediction/status",
    response_model=PredictionStatusResponse,
    summary="Prediction loop status",
)
async def get_prediction_status_route() -> PredictionStatusResponse:
    status = get_prediction_status()
    return PredictionStatusResponse(**status)
