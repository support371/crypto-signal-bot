# backend/routes/signal.py
"""
PHASE 7 — Signal routes.

GET /signal/latest — runtime-backed by prediction service.
                     Never returns mock/synthetic signal state.

Signal is unavailable state (available=False) is explicit and
actionable — the frontend treats it as "engine offline", not as
a trading signal.

Protected files: none accessed here.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional

from backend.services.prediction_bot.service import (
    get_latest_signal,
    get_prediction_status,
    SignalOutput,
)

router = APIRouter(tags=["signals"])


class SignalResponse(BaseModel):
    symbol:     str
    direction:  str       # "UP" | "DOWN" | "NEUTRAL"
    confidence: float
    regime:     str       # "TREND" | "RANGE" | "CHAOS"
    horizon:    int
    available:  bool      # False = engine offline, not a valid signal
    source:     str       # "signal_engine" | "unavailable" | "engine_error"
    computed_at: int
    reasoning:  Optional[str]


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
    symbol: str = Query(..., description="Backend symbol, e.g. BTCUSDT"),
) -> SignalResponse:
    symbol = symbol.strip().upper()
    sig = await get_latest_signal(symbol)
    return SignalResponse(
        symbol=sig.symbol or symbol,
        direction=sig.direction,
        confidence=sig.confidence,
        regime=sig.regime,
        horizon=sig.horizon,
        available=sig.available,
        source=sig.source,
        computed_at=sig.computed_at,
        reasoning=sig.reasoning,
    )


@router.get(
    "/prediction/status",
    response_model=PredictionStatusResponse,
    summary="Prediction loop status",
)
async def get_prediction_status_route() -> PredictionStatusResponse:
    status = get_prediction_status()
    return PredictionStatusResponse(**status)
