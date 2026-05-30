# backend/routes/portfolio_v1.py
"""
Portfolio & PnL REST API — V1

POST /api/v1/orders               — submit a paper order
GET  /api/v1/orders               — list orders (optional ?status=)
GET  /api/v1/orders/{order_id}    — single order
GET  /api/v1/portfolio            — full portfolio summary
GET  /api/v1/portfolio/trades     — trade history
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from backend.services.portfolio.service import (
    get_daily_pnl,
    get_equity_history,
    get_order,
    get_orders,
    get_portfolio_summary,
    get_positions_detail,
    get_trades,
    submit_order,
)

router = APIRouter(prefix="/api/v1", tags=["portfolio_v1"])


# ─── Request / Response models ───────────────────────────────────

class OrderRequest(BaseModel):
    symbol:     str
    side:       str        # BUY | SELL
    order_type: str = "MARKET"   # MARKET | LIMIT
    qty:        float
    price:      Optional[float] = None   # required for LIMIT

    @field_validator("side")
    @classmethod
    def validate_side(cls, v):
        v = v.upper()
        if v not in ("BUY", "SELL"):
            raise ValueError("side must be BUY or SELL")
        return v

    @field_validator("order_type")
    @classmethod
    def validate_type(cls, v):
        v = v.upper()
        if v not in ("MARKET", "LIMIT"):
            raise ValueError("order_type must be MARKET or LIMIT")
        return v

    @field_validator("qty")
    @classmethod
    def validate_qty(cls, v):
        if v <= 0:
            raise ValueError("qty must be positive")
        return v


class OrderOut(BaseModel):
    id:         str
    symbol:     str
    side:       str
    order_type: str
    qty:        float
    price:      Optional[float]
    status:     str
    created_at: int
    updated_at: int


class TradeOut(BaseModel):
    id:           int
    order_id:     str
    symbol:       str
    side:         str
    qty:          float
    price:        float
    fee:          float
    realized_pnl: Optional[float]
    executed_at:  int


class PortfolioOut(BaseModel):
    account_id:            str
    cash_balance:          float
    equity:                float
    max_equity:            float
    drawdown_pct:          float
    total_realized_pnl:    float
    total_unrealized_pnl:  float
    trade_count:           int
    win_rate_pct:          float
    open_positions:        List[Dict[str, Any]]
    as_of:                 int


# ─── Routes ──────────────────────────────────────────────────────

@router.post("/orders", response_model=OrderOut, status_code=201,
             summary="Submit a paper order")
async def create_order(body: OrderRequest) -> OrderOut:
    if body.order_type == "LIMIT" and body.price is None:
        raise HTTPException(status_code=422, detail="price required for LIMIT orders")
    order = await submit_order(
        symbol=body.symbol, side=body.side,
        order_type=body.order_type, qty=body.qty, price=body.price,
    )
    return OrderOut(**{
        "id": order.id, "symbol": order.symbol, "side": order.side,
        "order_type": order.order_type, "qty": float(order.qty),
        "price": float(order.price) if order.price else None,
        "status": order.status, "created_at": order.created_at,
        "updated_at": order.updated_at,
    })


@router.get("/orders", response_model=List[OrderOut],
            summary="List paper orders")
async def list_orders(
    status: Optional[str] = Query(None, description="Filter by status: PENDING|FILLED|CANCELLED"),
    limit: int = Query(50, ge=1, le=200),
) -> List[OrderOut]:
    return [OrderOut(**o) for o in get_orders(status=status, limit=limit)]


@router.get("/orders/{order_id}", response_model=OrderOut,
            summary="Get a single order")
async def get_order_route(order_id: str) -> OrderOut:
    o = get_order(order_id)
    if not o:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
    return OrderOut(**o)


@router.get("/portfolio", response_model=PortfolioOut,
            summary="Full portfolio summary with positions and PnL")
async def portfolio_summary() -> PortfolioOut:
    data = await get_portfolio_summary()
    return PortfolioOut(**data)


@router.get("/portfolio/trades", response_model=List[TradeOut],
            summary="Trade history")
async def portfolio_trades(
    symbol: Optional[str] = Query(None, description="Filter by symbol"),
    limit: int = Query(50, ge=1, le=500),
) -> List[TradeOut]:
    return [TradeOut(**t) for t in get_trades(limit=limit, symbol=symbol)]


# ─── Daily PnL models ────────────────────────────────────────────

class DailyPnlOut(BaseModel):
    date_utc:        str
    account_id:      str
    realized_pnl:    float
    unrealized_pnl:  float
    total_pnl:       float
    trade_count:     int
    win_count:       int
    loss_count:      int


class EquityPointOut(BaseModel):
    timestamp:    int
    equity:       float
    cash:         float
    unrealized:   float
    drawdown_pct: float
    max_equity:   float


class PositionDetailOut(BaseModel):
    symbol:               str
    qty:                  float
    avg_entry_price:      float
    mark_price:           float
    notional_value:       float
    unrealized_pnl:       float
    unrealized_pnl_pct:   float
    realized_pnl:         float
    total_pnl:            float
    lots:                 int
    oldest_lot_ts:        int


# ─── New routes ───────────────────────────────────────────────────

@router.get("/portfolio/positions", response_model=List[PositionDetailOut],
            summary="Open positions with full PnL breakdown")
async def positions_detail() -> List[PositionDetailOut]:
    """
    Returns each open position with unrealized PnL, realized PnL,
    notional value, PnL %, and lot count — sorted by notional value descending.
    """
    return [PositionDetailOut(**p) for p in await get_positions_detail()]


@router.get("/portfolio/pnl/daily", response_model=List[DailyPnlOut],
            summary="Daily realized + unrealized PnL aggregates")
async def daily_pnl(
    days: int = Query(30, ge=1, le=365, description="Lookback window in days"),
) -> List[DailyPnlOut]:
    """
    Returns per-day PnL aggregated from trade history.
    Today's unrealized PnL is computed live.
    Sorted newest-first.
    """
    rows = await get_daily_pnl(days=days)
    return [DailyPnlOut(**r) for r in rows]


@router.get("/portfolio/equity-history", response_model=List[EquityPointOut],
            summary="Equity snapshot time series")
async def equity_history(
    hours: int = Query(24, ge=1, le=720, description="Lookback window in hours (max 720 = 30d)"),
) -> List[EquityPointOut]:
    """
    Returns equity snapshots from the DB for charting.
    Snapshots are written every 5 minutes by the background loop.
    """
    rows = await get_equity_history(hours=hours)
    return [EquityPointOut(**r) for r in rows]
