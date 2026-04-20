# backend/routes/intent.py
"""
PHASE 9 — Intent routes.

POST /intent/paper — paper mode execution
POST /intent/live  — live mode execution

Both routes go through the same coordinator pipeline.
The only difference is the mode field, which determines whether
the exchange adapter uses the paper ledger or submits to a real exchange.

Rules:
  - No simulated fills (coordinator routes through exchange adapters)
  - Kill switch always checked first
  - Risk approval checked before routing
  - No client-side execution truth

Protected files: none accessed here.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field, field_validator

from backend.engine.coordinator import (
    ExecutionIntent,
    ExecutionResult,
    IntentValidationError,
    KillSwitchActive,
    RiskGateDenied,
    execute_intent,
)
from backend.engine.routing import ExecutionFailed, ExecutionRejected
from backend.config.loader import get_auth_config

router = APIRouter(tags=["execution"])


# ---------------------------------------------------------------------------
# Auth dependency (write endpoint)
# ---------------------------------------------------------------------------

def require_operator_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    auth = get_auth_config()
    if not auth.auth_enabled:
        return
    if not x_api_key or x_api_key != auth.api_key:
        raise HTTPException(status_code=401, detail="X-API-Key required for execution endpoints.")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class IntentRequest(BaseModel):
    symbol:     str = Field(..., description="Backend symbol, e.g. BTCUSDT")
    side:       str = Field(..., description="BUY or SELL")
    order_type: str = Field(default="MARKET", description="MARKET or LIMIT")
    quantity:   float = Field(..., gt=0, description="Order quantity")
    price:      Optional[float] = Field(default=None, description="Required for LIMIT orders")
    notes:      Optional[str] = Field(default=None, description="Operator notes (audit)")

    @field_validator("side")
    @classmethod
    def validate_side(cls, v: str) -> str:
        v = v.upper()
        if v not in ("BUY", "SELL"):
            raise ValueError("side must be BUY or SELL")
        return v

    @field_validator("order_type")
    @classmethod
    def validate_order_type(cls, v: str) -> str:
        v = v.upper()
        if v not in ("MARKET", "LIMIT"):
            raise ValueError("order_type must be MARKET or LIMIT")
        return v


class IntentResponse(BaseModel):
    order_id:       str
    status:         str
    symbol:         str
    side:           str
    quantity:       float
    fill_price:     Optional[float]
    filled_qty:     float
    venue:          str
    mode:           str
    realized_pnl:   Optional[float]
    created_at:     int
    elapsed_ms:     int
    error:          Optional[str]


def _result_to_response(r: ExecutionResult) -> IntentResponse:
    return IntentResponse(
        order_id=r.order_id,
        status=r.status,
        symbol=r.intent.symbol,
        side=r.intent.side,
        quantity=float(r.intent.quantity),
        fill_price=float(r.fill_price) if r.fill_price else None,
        filled_qty=float(r.filled_qty),
        venue=r.venue,
        mode=r.intent.mode,
        realized_pnl=float(r.realized_pnl) if r.realized_pnl else None,
        created_at=r.created_at,
        elapsed_ms=r.elapsed_ms,
        error=r.error,
    )


# ---------------------------------------------------------------------------
# POST /intent/paper
# ---------------------------------------------------------------------------

@router.post(
    "/intent/paper",
    response_model=IntentResponse,
    summary="Submit paper trading intent",
    description=(
        "Routes through the execution coordinator in paper mode. "
        "Uses real exchange prices for simulation accuracy. "
        "Kill switch and risk gate are checked before submission."
    ),
    dependencies=[Depends(require_operator_key)],
)
async def submit_paper_intent(body: IntentRequest) -> IntentResponse:
    intent = ExecutionIntent(
        symbol=body.symbol.upper(),
        side=body.side,
        order_type=body.order_type,
        quantity=Decimal(str(body.quantity)),
        price=Decimal(str(body.price)) if body.price else None,
        mode="paper",
        notes=body.notes,
    )
    return await _execute(intent)


# ---------------------------------------------------------------------------
# POST /intent/live
# ---------------------------------------------------------------------------

@router.post(
    "/intent/live",
    response_model=IntentResponse,
    summary="Submit live trading intent",
    description=(
        "Routes through the execution coordinator in live mode. "
        "Submits to real exchange API. "
        "Kill switch and risk gate are checked before submission."
    ),
    dependencies=[Depends(require_operator_key)],
)
async def submit_live_intent(body: IntentRequest) -> IntentResponse:
    intent = ExecutionIntent(
        symbol=body.symbol.upper(),
        side=body.side,
        order_type=body.order_type,
        quantity=Decimal(str(body.quantity)),
        price=Decimal(str(body.price)) if body.price else None,
        mode="live",
        notes=body.notes,
    )
    return await _execute(intent)


# ---------------------------------------------------------------------------
# Shared execution handler
# ---------------------------------------------------------------------------

async def _execute(intent: ExecutionIntent) -> IntentResponse:
    try:
        result = await execute_intent(intent)
        return _result_to_response(result)

    except KillSwitchActive as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "kill_switch_active", "reason": str(exc)},
        )

    except RiskGateDenied as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "risk_gate_denied", "reason": exc.reason},
        )

    except IntentValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_intent", "reason": str(exc)},
        )

    except ExecutionRejected as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "order_rejected", "reason": exc.reason},
        )

    except ExecutionFailed as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "execution_failed", "reason": exc.reason},
        )
