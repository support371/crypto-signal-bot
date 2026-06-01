# backend/routes/decisions_v1.py
"""
Decision trace endpoints — read-only access to the in-memory decision log.

Routes:
  GET /api/v1/decisions            → recent traces (last 50)
  GET /api/v1/decisions/holds      → HOLD-only traces with reasons
  GET /api/v1/decisions/stats      → aggregate counts (buy/sell/hold breakdown)
  GET /api/v1/decisions/{symbol}   → traces for a specific symbol
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from backend.logic.decision_tracer import decision_tracer

router = APIRouter(prefix="/api/v1/decisions", tags=["decisions"])


@router.get("")
def get_recent_decisions(n: int = Query(default=50, ge=1, le=500)):
    """Return the last N decision traces (newest first)."""
    return {
        "traces": decision_tracer.get_recent(n),
        "count": len(decision_tracer.get_recent(n)),
    }


@router.get("/holds")
def get_hold_decisions(n: int = Query(default=50, ge=1, le=500)):
    """
    Return HOLD decisions only — shows why the executor did NOT trade.
    Essential for debugging stalled signal execution.
    Includes hold_reasons with structured codes (LOW_CONFIDENCE, MAX_POSITIONS_REACHED, etc.)
    """
    holds = decision_tracer.get_hold_traces(n)
    return {
        "holds": holds,
        "count": len(holds),
        "message": "HOLD traces show why trades were NOT executed. "
                   "Check hold_reasons[].code for details.",
    }


@router.get("/stats")
def get_decision_stats():
    """Return aggregate decision statistics: total, buy/sell/hold counts, hold breakdown."""
    return decision_tracer.get_stats()


@router.get("/{symbol}")
def get_decisions_for_symbol(symbol: str, n: int = Query(default=50, ge=1, le=200)):
    """Return decision traces for a specific symbol (e.g. BTCUSDT)."""
    traces = decision_tracer.get_for_symbol(symbol.upper(), n)
    return {
        "symbol": symbol.upper(),
        "traces": traces,
        "count": len(traces),
    }
