# backend/replay/routes.py
"""
Replay API endpoints.

  POST /api/v1/replay             → replay signal generation on POSTed candles
  GET  /api/v1/replay/strategies  → list available strategies
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.replay.replayer import Replayer, ReplayCandle

router = APIRouter(prefix="/api/v1/replay", tags=["replay"])
_replayer = Replayer()


class ReplayRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    strategy_id: Optional[str] = Field(default="trend_v1")
    candles: List[Dict[str, Any]] = Field(
        ...,
        description="List of OHLCV candles: {timestamp, open, high, low, close, volume}",
        min_length=1,
    )


@router.post("")
def run_replay(req: ReplayRequest):
    """
    Replay signal generation on provided OHLCV candles.
    Returns signal sequence with determinism proof (input/output hashes).
    Minimum 26 candles required for any signals (MACD warmup).
    """
    try:
        candles = [ReplayCandle.from_dict(c) for c in req.candles]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid candle format: {exc}")

    if len(candles) > 1000:
        raise HTTPException(status_code=400, detail="Maximum 1000 candles per replay request.")

    result = _replayer.replay(
        symbol=req.symbol.upper(),
        candles=candles,
        strategy_id=req.strategy_id,
    )
    return result.to_dict()


@router.get("/strategies")
def get_replay_strategies():
    """List available replay strategies."""
    return {
        "strategies": [
            {
                "id": "trend_v1",
                "name": "EMA Trend-Following",
                "indicators": ["EMA20", "EMA50", "EMA200", "MACD", "RSI"],
                "min_candles": 26,
            },
            {
                "id": "mean_reversion_v1",
                "name": "RSI + Bollinger Mean-Reversion",
                "indicators": ["RSI14", "BollingerBands20"],
                "min_candles": 26,
            },
            {
                "id": "momentum_v1",
                "name": "MACD Momentum",
                "indicators": ["MACD12_26_9", "RSI14"],
                "min_candles": 26,
            },
        ],
        "determinism_guaranteed": True,
        "note": "Same candles + same strategy_id always produce the same output_hash.",
    }
