"""Trading, portfolio, and price endpoints."""

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend import app_state
from backend.dependencies import require_auth
from backend.logic import context, rate_limit
from backend.logic.market_state import build_market_state_result
from backend.models.execution_intent import IntentRequest, IntentResponse


class MarketStateRequest(BaseModel):
    symbol: str = "BTCUSDT"
    price: float = Field(..., gt=0)
    change24h: float = 0.0
    volume24h: float = 0.0
    marketCap: float = 0.0
    riskTolerance: float = Field(0.5, ge=0.0, le=1.0)
    spreadStressThreshold: float = Field(0.002, gt=0.0)
    volatilitySensitivity: float = Field(0.5, ge=0.0, le=2.0)
    positionSizeFraction: float = Field(0.1, ge=0.0, le=1.0)


class WithdrawRequest(BaseModel):
    asset: str = "USDT"
    amount: float = 100.0
    address: str = "paper-wallet"


router = APIRouter(dependencies=[Depends(rate_limit.rate_limit)])


@router.get("/balance")
def get_balance():
    p = app_state.portfolio()
    return {"balances": p.get_all_balances(), "positions": p.get_positions()}


@router.get("/positions")
def get_positions_api():
    return {"positions": app_state.portfolio().get_positions()}


@router.get("/orders")
def get_orders_api(symbol: str | None = Query(None)):
    orders = app_state.portfolio().open_orders
    if symbol:
        orders = [o for o in orders if o.symbol == symbol.upper()]
    return {
        "orders": [
            {
                "id": o.id, "symbol": o.symbol, "side": o.side.value,
                "order_type": o.order_type.value, "quantity": o.quantity,
                "price": o.price, "status": o.status.value, "created_at": o.created_at,
            } for o in orders
        ]
    }


@router.get("/price")
def get_price_api(symbol: str = Query("BTCUSDT")):
    normalized_symbol = symbol.upper()
    trading_mode = app_state.trading_mode()
    use_live = app_state.paper_use_live_market_data()
    mde = app_state.market_data_exchange()

    if trading_mode == "paper" and use_live:
        svc = app_state.get_market_data_service()
        snap = svc.get_snapshot(normalized_symbol)
        if snap:
            return {
                "symbol": normalized_symbol,
                "price": round(float(snap["price"]), 8),
                "change24h": float(snap.get("change24h", 0.0)),
                "volume24h": float(snap.get("volume24h", 0.0)),
                "marketCap": float(snap.get("marketCap", 0.0)),
                "timestamp": snap["timestamp"],
                "source": snap.get("source", f"{mde}-public"),
                "exchange": snap.get("exchange", mde),
                "market_data_mode": "live_public_paper",
            }
        status = svc.get_status()
        tracked = status.get("symbols", [])
        if normalized_symbol not in [s.upper() for s in tracked]:
            return JSONResponse(
                status_code=404,
                content={"error": "symbol_not_tracked", "symbol": normalized_symbol},
            )
        return JSONResponse(
            status_code=503,
            content={"error": "market_data_unavailable", "symbol": normalized_symbol},
        )

    ea = app_state.adapter()
    if trading_mode == "live" and ea.mode != "paper":
        try:
            price = ea.get_price(normalized_symbol)
            return {
                "symbol": normalized_symbol, "price": round(float(price), 8),
                "change24h": 0.0, "volume24h": 0.0, "marketCap": 0.0,
                "timestamp": time.time(), "source": "execution_adapter",
                "exchange": ea.exchange, "market_data_mode": "execution_only",
            }
        except Exception as exc:
            from backend.exceptions import ExchangeAPIError
            raise ExchangeAPIError(f"Live price fetch failed: {exc}")

    if trading_mode == "live" and ea.mode == "paper":
        return JSONResponse(
            status_code=503,
            content={"error": "execution_unavailable", "symbol": normalized_symbol},
        )

    price = app_state.synthetic_price(normalized_symbol)
    return {
        "symbol": normalized_symbol, "price": round(price, 8),
        "change24h": 0.0, "volume24h": 0.0, "marketCap": 0.0,
        "timestamp": time.time(), "source": "synthetic",
        "exchange": None, "market_data_mode": "synthetic_paper",
    }


@router.post("/market-state")
def market_state_api(req: MarketStateRequest, _: None = Depends(require_auth)):
    result = build_market_state_result(
        symbol=req.symbol, price=req.price, change24h=req.change24h,
        volume24h=req.volume24h, market_cap=req.marketCap,
        risk_tolerance=req.riskTolerance, spread_stress_threshold=req.spreadStressThreshold,
        volatility_sensitivity=req.volatilitySensitivity,
        position_size_fraction=req.positionSizeFraction,
        market_data_source="manual",
    )
    normalized_symbol = req.symbol.upper()
    timestamp = time.time()
    context.latest_signal_by_symbol[normalized_symbol] = result
    context.latest_signal_ts_by_symbol[normalized_symbol] = timestamp
    return result


@router.post("/intent/live", response_model=IntentResponse)
def intent_live_api(req: IntentRequest, _: None = Depends(require_auth)):
    raise HTTPException(status_code=403, detail="Live execution is disabled.")


@router.post("/intent/paper", response_model=IntentResponse)
def intent_paper_api(req: IntentRequest, _: None = Depends(require_auth)):
    return app_state.process_intent(req, "paper")


@router.post("/withdraw")
def withdraw_api(req: WithdrawRequest, _: None = Depends(require_auth)):
    raise HTTPException(
        status_code=403,
        detail={"mode": "safe", "reason": "withdrawals_disabled", "message": "Withdrawals are disabled. This is a paper-only simulator."}
    )
