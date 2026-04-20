# backend/routes/broker.py
"""
Broker introspection routes (venue-agnostic).

GET /broker/venues
GET /broker/{venue}/health
GET /broker/{venue}/positions
GET /broker/{venue}/orders
GET /broker/{venue}/account

Rules:
  - Output always normalized (no raw MT5 types in responses)
  - Auth consistent with existing control-plane policy
  - No frontend secrets exposed
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Header

from backend.engine.venue_registry import all_venues, get_venue, is_available
from backend.adapters.brokers.exceptions import BrokerError
from backend.middleware.auth import require_write_auth

router = APIRouter(prefix="/broker", tags=["broker"])


def _require_read(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    """Read endpoints are public (no auth required for introspection)."""
    pass


@router.get("/venues")
async def list_venues() -> list[dict]:
    return [
        {
            "venue_id":   v.venue_id,
            "venue_type": v.venue_type,
            "available":  v.available,
            "error":      v.error,
        }
        for v in all_venues()
    ]


@router.get("/{venue}/health")
async def broker_health(venue: str) -> dict:
    info = get_venue(venue)
    if not info:
        raise HTTPException(status_code=404, detail=f"Venue '{venue}' not registered.")
    try:
        h = await info.adapter.health()
        return {
            "venue":              h.venue,
            "terminal_connected": h.terminal_connected,
            "broker_session_ok":  h.broker_session_ok,
            "symbols_loaded":     h.symbols_loaded,
            "order_path_ok":      h.order_path_ok,
            "latency_ms":         h.latency_ms,
            "last_error":         h.last_error,
            "timestamp":          h.timestamp,
        }
    except Exception as exc:
        return {"venue": venue, "error": str(exc), "available": False}


@router.get("/{venue}/account")
async def broker_account(venue: str) -> dict:
    info = get_venue(venue)
    if not info or not info.available:
        raise HTTPException(status_code=503, detail=f"Venue '{venue}' unavailable.")
    try:
        a = await info.adapter.account_info()
        return {
            "venue": a.venue, "login_id": a.login_id, "server": a.server,
            "equity": float(a.equity), "balance": float(a.balance),
            "margin": float(a.margin), "free_margin": float(a.free_margin),
            "margin_level": a.margin_level, "currency": a.currency,
            "leverage": a.leverage, "timestamp": a.timestamp,
        }
    except BrokerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/{venue}/positions")
async def broker_positions(venue: str) -> list[dict]:
    info = get_venue(venue)
    if not info or not info.available:
        raise HTTPException(status_code=503, detail=f"Venue '{venue}' unavailable.")
    try:
        positions = await info.adapter.positions()
        return [
            {
                "position_id":  p.position_id,
                "symbol":       p.symbol,
                "side":         p.side,
                "volume":       float(p.volume),
                "entry_price":  float(p.entry_price),
                "current_price": float(p.current_price),
                "sl":           float(p.sl) if p.sl else None,
                "tp":           float(p.tp) if p.tp else None,
                "unrealized_pnl": float(p.unrealized_pnl),
                "opened_at":    p.opened_at,
            }
            for p in positions
        ]
    except BrokerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/{venue}/orders")
async def broker_orders(venue: str) -> list[dict]:
    info = get_venue(venue)
    if not info or not info.available:
        raise HTTPException(status_code=503, detail=f"Venue '{venue}' unavailable.")
    try:
        orders = await info.adapter.orders(limit=100)
        return [
            {
                "broker_order_id": o.broker_order_id,
                "symbol":          o.symbol,
                "side":            o.side,
                "order_type":      o.order_type,
                "volume":          float(o.volume),
                "status":          o.status,
                "created_at":      o.created_at,
            }
            for o in orders
        ]
    except BrokerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ---------------------------------------------------------------------------
# backend/routes/mt5.py — MT5-specific control routes
# ---------------------------------------------------------------------------

mt5_router = APIRouter(prefix="/broker/mt5", tags=["mt5"])


@mt5_router.get("/health")
async def mt5_health() -> dict:
    return await broker_health("mt5")


@mt5_router.get("/account")
async def mt5_account() -> dict:
    return await broker_account("mt5")


@mt5_router.get("/symbols")
async def mt5_symbols() -> list[dict]:
    info = get_venue("mt5")
    if not info or not info.available:
        raise HTTPException(status_code=503, detail="MT5 unavailable.")
    try:
        syms = await info.adapter.symbols()
        return [
            {
                "broker_symbol":   s.broker_symbol,
                "internal_symbol": s.internal_symbol,
                "base_asset":      s.base_asset,
                "quote_asset":     s.quote_asset,
                "volume_min":      s.volume_min,
                "volume_step":     s.volume_step,
                "digits":          s.digits,
            }
            for s in syms
        ]
    except BrokerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@mt5_router.get("/positions")
async def mt5_positions() -> list[dict]:
    return await broker_positions("mt5")


@mt5_router.get("/orders")
async def mt5_orders() -> list[dict]:
    return await broker_orders("mt5")


@mt5_router.post("/connect", dependencies=[Depends(require_write_auth)])
async def mt5_connect() -> dict:
    """Explicit admin action — reconnect MT5 session."""
    info = get_venue("mt5")
    if not info:
        raise HTTPException(status_code=404, detail="MT5 not registered.")
    try:
        await info.adapter.connect()
        from backend.engine.venue_registry import mark_available
        mark_available("mt5")
        return {"status": "connected", "venue": "mt5"}
    except BrokerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@mt5_router.post("/disconnect", dependencies=[Depends(require_write_auth)])
async def mt5_disconnect() -> dict:
    """Explicit admin action — disconnect MT5 session."""
    info = get_venue("mt5")
    if not info:
        raise HTTPException(status_code=404, detail="MT5 not registered.")
    await info.adapter.disconnect()
    from backend.engine.venue_registry import mark_unavailable
    mark_unavailable("mt5", error="Manual disconnect")
    return {"status": "disconnected", "venue": "mt5"}
