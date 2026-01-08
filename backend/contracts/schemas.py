"""
Core data contracts for the trading pipeline, using Pydantic for validation.
"""
from typing import Dict, Any, Literal
from pydantic import BaseModel, Field

from enum import Enum

SignalDirection = Literal["UP", "DOWN", "NEUTRAL"]
MarketRegime = Literal["TREND", "RANGE", "CHAOS"]
Posture = Literal["GREEN", "AMBER", "RED"]

class IntentAction(str, Enum):
    ENTER_LONG = "ENTER_LONG"
    ENTER_SHORT = "ENTER_SHORT"
    EXIT = "EXIT"
    REDUCE = "REDUCE"
    HOLD = "HOLD"

class OrderStatus(str, Enum):
    NEW = "NEW"
    SENT = "SENT"
    ACKED = "ACKED"
    PARTIAL = "PARTIAL"
    FILLED = "FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"

class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"

class Signal(BaseModel):
    direction: SignalDirection
    confidence: float = Field(..., ge=0.0, le=1.0)
    regime: MarketRegime
    horizon_minutes: int = Field(..., gt=0)
    meta: Dict[str, Any] = {}

class MarketPosture(BaseModel):
    status: Posture
    reasons: list[str] = []

class ExecutionIntent(BaseModel):
    intent_id: str = Field(..., min_length=1)
    action: IntentAction
    symbol: str
    size_fraction: float = Field(..., ge=0.0, le=1.0)
    reason: str
    risk_score: float = Field(..., ge=0.0, le=100.0)

class OrderUpdate(BaseModel):
    order_id: str
    client_order_id: str
    status: OrderStatus
    filled_quantity: float = 0.0
    average_fill_price: float | None = None

class ExecutionReport(BaseModel):
    venue_order_id: str
    fill_id: str
    client_order_id: str
    symbol: str
    side: OrderSide
    quantity: float = Field(..., gt=0)
    price: float = Field(..., gt=0)
    timestamp: int

class PortfolioState(BaseModel):
    nav: float
    exposure: float
    positions: Dict[str, float] = {}
    balances: Dict[str, float] = {}
    drawdown: float

class AuditEvent(BaseModel):
    event_id: str
    trace_id: str
    event_type: str
    timestamp: int
    payload: Dict[str, Any]
