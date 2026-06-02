# backend/backtest/routes.py
"""
Backtest API endpoints.

  POST /api/v1/backtest              → run single-strategy backtest on provided candles
  POST /api/v1/backtest/compare      → run all 3 strategies, return comparison
  POST /api/v1/backtest/live         → fetch live OHLCV from exchange, then backtest
  GET  /api/v1/backtest/strategies   → list available strategies with descriptions
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.backtest.engine import BacktestEngine, STRATEGIES
from backend.replay.replayer import ReplayCandle

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/backtest", tags=["backtest"])
_engine = BacktestEngine()

_STRATEGY_META = {
    "trend_v1": {
        "name": "EMA Trend-Following",
        "description": "EMA 20/50/200 crossover with RSI and MACD confirmation. Follows sustained directional moves.",
        "best_for": "Trending markets",
        "indicators": ["EMA20", "EMA50", "EMA200", "RSI", "MACD"],
    },
    "mean_reversion_v1": {
        "name": "RSI + Bollinger Mean Reversion",
        "description": "Buys oversold conditions (RSI<30, price at lower Bollinger Band) and sells overbought (RSI>70, upper band).",
        "best_for": "Ranging / sideways markets",
        "indicators": ["RSI", "Bollinger Bands"],
    },
    "momentum_v1": {
        "name": "MACD Momentum",
        "description": "Enters when MACD line crosses above signal line with RSI confirmation. Captures early momentum moves.",
        "best_for": "Breakout / momentum markets",
        "indicators": ["MACD", "RSI"],
    },
}


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class BacktestRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    strategy_id: str = Field(default="trend_v1")
    candle_interval: str = Field(default="1d", description="e.g. 1h, 4h, 1d")
    candles: List[Dict[str, Any]] = Field(
        ...,
        description="OHLCV candles: {timestamp, open, high, low, close, volume}",
        min_length=26,
    )


class CompareRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    candle_interval: str = Field(default="1d")
    candles: List[Dict[str, Any]] = Field(
        ...,
        min_length=26,
    )


class LiveBacktestRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    strategy_id: Optional[str] = Field(default=None, description="None = compare all strategies")
    candle_interval: str = Field(default="1d")
    limit: int = Field(default=365, ge=50, le=1000, description="Number of candles to fetch")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/strategies")
def list_strategies():
    """List all available backtest strategies."""
    return {
        "strategies": [
            {"id": sid, **meta}
            for sid, meta in _STRATEGY_META.items()
        ]
    }


@router.post("")
def run_backtest(req: BacktestRequest):
    """
    Run a single-strategy backtest on provided OHLCV candles.
    Returns full metrics: win rate, Sharpe, max drawdown, equity curve, trade log.
    """
    if req.strategy_id not in STRATEGIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategy '{req.strategy_id}'. Valid: {STRATEGIES}",
        )
    if len(req.candles) > 2000:
        raise HTTPException(status_code=400, detail="Maximum 2000 candles per request.")

    try:
        candles = [ReplayCandle.from_dict(c) for c in req.candles]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid candle format: {exc}")

    try:
        result = _engine.run(
            symbol=req.symbol.upper(),
            candles=candles,
            strategy_id=req.strategy_id,
            candle_interval=req.candle_interval,
        )
    except Exception as exc:
        log.exception("Backtest failed")
        raise HTTPException(status_code=500, detail=str(exc))

    return result.to_dict()


@router.post("/compare")
def compare_strategies(req: CompareRequest):
    """
    Run all 3 strategies on the same candle set.
    Returns a side-by-side comparison with the best strategy highlighted.
    """
    if len(req.candles) > 2000:
        raise HTTPException(status_code=400, detail="Maximum 2000 candles per request.")

    try:
        candles = [ReplayCandle.from_dict(c) for c in req.candles]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid candle format: {exc}")

    try:
        comparison = _engine.compare_all(
            symbol=req.symbol.upper(),
            candles=candles,
            candle_interval=req.candle_interval,
        )
    except Exception as exc:
        log.exception("Backtest comparison failed")
        raise HTTPException(status_code=500, detail=str(exc))

    return comparison.to_dict()


@router.post("/live")
async def live_backtest(req: LiveBacktestRequest):
    """
    Fetch live OHLCV candles from the configured exchange, then run backtest.
    If strategy_id is None, compares all 3 strategies.
    """
    from backend.config.loader import get_exchange_config
    from backend.adapters.exchanges import get_market_data_adapter

    try:
        cfg = get_exchange_config()
        adapter = get_market_data_adapter(cfg)
        ohlcv = await adapter.fetch_ohlcv(
            symbol=req.symbol.upper(),
            interval=req.candle_interval,
            limit=req.limit,
        )
    except Exception as exc:
        log.exception("Failed to fetch live candles for backtest")
        raise HTTPException(status_code=502, detail=f"Could not fetch market data: {exc}")

    if not ohlcv:
        raise HTTPException(status_code=502, detail="Exchange returned empty candle data.")

    # Convert OhlcvCandle → ReplayCandle
    candles = [
        ReplayCandle(
            timestamp=float(c.time),
            open=float(c.open),
            high=float(c.high),
            low=float(c.low),
            close=float(c.close),
            volume=float(c.volume),
        )
        for c in ohlcv
    ]

    if len(candles) < 26:
        raise HTTPException(
            status_code=422,
            detail=f"Only {len(candles)} candles available — need at least 26 for MACD warmup.",
        )

    try:
        if req.strategy_id:
            if req.strategy_id not in STRATEGIES:
                raise HTTPException(status_code=400, detail=f"Unknown strategy '{req.strategy_id}'")
            result = _engine.run(
                symbol=req.symbol.upper(),
                candles=candles,
                strategy_id=req.strategy_id,
                candle_interval=req.candle_interval,
            )
            return result.to_dict()
        else:
            comparison = _engine.compare_all(
                symbol=req.symbol.upper(),
                candles=candles,
                candle_interval=req.candle_interval,
            )
            return comparison.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Live backtest failed")
        raise HTTPException(status_code=500, detail=str(exc))
