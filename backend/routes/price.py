# backend/routes/price.py
"""
PHASE 6 — Normalized price routes.

Replaces any backend /price route that had a synthetic fallback path.

Routes:
  GET /price          — single symbol current price
  GET /prices/batch   — multiple symbols (frontend usePrices.ts target)
  GET /price/ohlcv    — OHLCV candle history (PriceChart.tsx target)
  GET /exchange/status — normalized status (removes "SYNTHETIC" mode string)

Rules:
  - All price responses come from MarketDataService (adapter-backed).
  - When the exchange is unreachable: HTTP 503 with error detail.
  - Stale data: returned with stale=True and a Retry-After header.
    NOT silently served as fresh.
  - "SYNTHETIC" is not a valid market_data_mode in any response from here.

Protected files: none touched.
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.services.market_data.service import (
    MarketDataUnavailable,
    MarketDataStale,
    PriceSnapshot,
    OhlcvSnapshot,
    get_price,
    get_price_batch,
    get_ohlcv,
    get_exchange_status,
    TRACKED_SYMBOLS,
)

router = APIRouter(tags=["market-data"])

# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class PriceResponse(BaseModel):
    symbol:           str
    price:            float
    bid:              float
    ask:              float
    spread_pct:       float
    change24h:        float
    volume24h:        float
    market_data_mode: str   # "live" | "paper_live" | "unavailable" — never "SYNTHETIC"
    source:           str
    fetched_at:       int
    stale:            bool
    timestamp:        int   # alias for fetched_at — frontend usePrices.ts expects this


class OhlcvCandleOut(BaseModel):
    time:   int
    open:   float
    high:   float
    low:    float
    close:  float
    volume: float


class OhlcvResponse(BaseModel):
    symbol:    str
    interval:  str
    candles:   list[OhlcvCandleOut]
    source:    str
    fetched_at: int
    stale:     bool


class BatchPriceItem(BaseModel):
    id:           str
    symbol:       str
    name:         str
    price:        float
    change24h:    float
    volume24h:    float
    marketCap:    float
    lastUpdated:  str
    stale:        bool


class BatchPricesResponse(BaseModel):
    prices:  list[BatchPriceItem]
    source:  str
    as_of:   int
    cached:  bool


# Coin metadata for batch response (id/name enrichment)
_COIN_META: dict[str, dict] = {
    "BTCUSDT":  {"id": "bitcoin",     "symbol": "BTC",  "name": "Bitcoin"},
    "ETHUSDT":  {"id": "ethereum",    "symbol": "ETH",  "name": "Ethereum"},
    "SOLUSDT":  {"id": "solana",      "symbol": "SOL",  "name": "Solana"},
    "BNBUSDT":  {"id": "binancecoin", "symbol": "BNB",  "name": "BNB"},
    "ADAUSDT":  {"id": "cardano",     "symbol": "ADA",  "name": "Cardano"},
    "XRPUSDT":  {"id": "ripple",      "symbol": "XRP",  "name": "XRP"},
    "DOTUSDT":  {"id": "polkadot",    "symbol": "DOT",  "name": "Polkadot"},
    "AVAXUSDT": {"id": "avalanche-2", "symbol": "AVAX", "name": "Avalanche"},
    "DOGEUSDT": {"id": "dogecoin",    "symbol": "DOGE", "name": "Dogecoin"},
    "LINKUSDT": {"id": "chainlink",   "symbol": "LINK", "name": "Chainlink"},
}

_VALID_INTERVALS = {"1m", "5m", "15m", "1h", "4h", "1d"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _snapshot_to_response(snap: PriceSnapshot) -> PriceResponse:
    return PriceResponse(
        symbol=snap.symbol,
        price=float(snap.price),
        bid=float(snap.bid),
        ask=float(snap.ask),
        spread_pct=snap.spread_pct,
        change24h=snap.change24h,
        volume24h=float(snap.volume24h),
        market_data_mode=snap.market_data_mode,
        source=snap.source,
        fetched_at=snap.fetched_at,
        stale=snap.stale,
        timestamp=snap.fetched_at,
    )


def _stale_response(error: MarketDataStale) -> JSONResponse:
    """
    Return stale data with clear headers — not as fresh data.
    HTTP 200 with stale=True + Retry-After so clients know to re-poll.
    """
    t = error.stale_ticker
    if t is None:
        raise HTTPException(status_code=503, detail=str(error))
    now = int(time.time())
    return JSONResponse(
        status_code=200,
        headers={
            "X-Market-Data-Stale": "true",
            "Retry-After": "15",
        },
        content={
            "symbol": t.symbol,
            "price": float(t.price),
            "bid": float(t.bid),
            "ask": float(t.ask),
            "spread_pct": t.spread_pct,
            "change24h": t.change24h,
            "volume24h": float(t.volume24h),
            "market_data_mode": "unavailable",
            "source": "stale_cache",
            "fetched_at": now,
            "stale": True,
            "timestamp": now,
            "stale_reason": str(error),
        },
    )


# ---------------------------------------------------------------------------
# GET /price
# ---------------------------------------------------------------------------

@router.get(
    "/price",
    response_model=PriceResponse,
    summary="Current price for one symbol",
)
async def get_single_price(
    symbol: str = Query(..., description="Backend symbol, e.g. BTCUSDT"),
) -> PriceResponse | JSONResponse:
    symbol = symbol.strip().upper()
    try:
        snap = await get_price(symbol)
        return _snapshot_to_response(snap)
    except MarketDataStale as exc:
        return _stale_response(exc)
    except MarketDataUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "market_data_unavailable",
                "reason": exc.reason,
                "adapter_errors": exc.adapter_errors,
                "synthetic_fallback": False,  # explicit confirmation
            },
        )


# ---------------------------------------------------------------------------
# GET /prices/batch
# ---------------------------------------------------------------------------

@router.get(
    "/prices/batch",
    response_model=BatchPricesResponse,
    summary="Batch prices for tracked coins",
)
async def get_prices_batch(
    symbols: Optional[str] = Query(
        default=None,
        description="Comma-separated symbols, e.g. BTCUSDT,ETHUSDT. Omit for all.",
    ),
) -> BatchPricesResponse:
    if symbols:
        requested = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        valid = [s for s in requested if s in _COIN_META]
        if not valid:
            raise HTTPException(status_code=400, detail="No valid symbols in request.")
    else:
        valid = list(_COIN_META.keys())

    try:
        snapshots = await get_price_batch(valid)
    except MarketDataUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "market_data_unavailable", "reason": exc.reason},
        )

    if not snapshots:
        raise HTTPException(status_code=503, detail="All price fetches failed.")

    import datetime
    now = int(time.time())
    items = []
    for snap in snapshots:
        meta = _COIN_META.get(snap.symbol, {
            "id": snap.symbol.lower(),
            "symbol": snap.symbol.replace("USDT", ""),
            "name": snap.symbol,
        })
        items.append(BatchPriceItem(
            id=meta["id"],
            symbol=meta["symbol"],
            name=meta["name"],
            price=float(snap.price),
            change24h=snap.change24h,
            volume24h=float(snap.volume24h),
            marketCap=0.0,  # populated by CoinGecko enrichment layer if configured
            lastUpdated=datetime.datetime.utcfromtimestamp(snap.fetched_at).isoformat() + "Z",
            stale=snap.stale,
        ))

    sources = list({s.source for s in snapshots})
    return BatchPricesResponse(
        prices=items,
        source=sources[0] if len(sources) == 1 else "mixed",
        as_of=now,
        cached=False,
    )


# ---------------------------------------------------------------------------
# GET /price/ohlcv
# ---------------------------------------------------------------------------

@router.get(
    "/price/ohlcv",
    response_model=OhlcvResponse,
    summary="OHLCV candle history — real exchange data only",
)
async def get_ohlcv_route(
    symbol:   str = Query(..., description="Backend symbol, e.g. BTCUSDT"),
    interval: str = Query(default="1h", description="Candle interval"),
    limit:    int = Query(default=24, ge=1, le=200),
) -> OhlcvResponse:
    symbol = symbol.strip().upper()
    interval = interval.strip().lower()

    if interval not in _VALID_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interval '{interval}'. Valid: {sorted(_VALID_INTERVALS)}",
        )

    try:
        snap = await get_ohlcv(symbol, interval=interval, limit=limit)
    except MarketDataUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "ohlcv_unavailable",
                "reason": exc.reason,
                # Explicitly confirm no synthetic data will be fabricated
                "synthetic_fallback": False,
            },
        )

    return OhlcvResponse(
        symbol=snap.symbol,
        interval=snap.interval,
        candles=[
            OhlcvCandleOut(
                time=c.time,
                open=float(c.open),
                high=float(c.high),
                low=float(c.low),
                close=float(c.close),
                volume=float(c.volume),
            )
            for c in snap.candles
        ],
        source=snap.source,
        fetched_at=snap.fetched_at,
        stale=snap.stale,
    )


# ---------------------------------------------------------------------------
# GET /exchange/status — normalized (removes "SYNTHETIC" mode)
# ---------------------------------------------------------------------------

@router.get(
    "/exchange/status",
    summary="Exchange connectivity status — SYNTHETIC mode removed",
)
async def get_exchange_status_route() -> dict:
    """
    Returns exchange status.
    market_data_mode is "live" | "paper_live" | "unavailable".
    "SYNTHETIC" is explicitly banned from this response.
    """
    try:
        status = await get_exchange_status()
        return {
            "connected":             status.connected,
            "mode":                  status.mode,
            "exchange_name":         status.exchange_name,
            "market_data_available": status.market_data_available,
            "market_data_mode":      status.market_data_mode,
            "connection_state":      status.connection_state,
            "fallback_active":       False,   # synthetic fallback removed
            "stale":                 status.stale,
            "source":                status.source,
            "error":                 status.error,
        }
    except Exception as exc:
        return {
            "connected":             False,
            "mode":                  "unavailable",
            "exchange_name":         "unknown",
            "market_data_available": False,
            "market_data_mode":      "unavailable",  # never "SYNTHETIC"
            "connection_state":      "offline",
            "fallback_active":       False,
            "stale":                 True,
            "source":                None,
            "error":                 str(exc),
        }
