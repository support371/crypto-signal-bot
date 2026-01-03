"""
Core data contracts for the trading pipeline, using Pydantic for validation.
"""
from typing import Dict, Any, Literal
from pydantic import BaseModel, Field

# ============================================================
# Core Enums
# ============================================================

SignalDirection = Literal["UP", "DOWN", "NEUTRAL"]
MarketRegime = Literal["TREND", "RANGE", "CHAOS"]
Posture = Literal["GREEN", "AMBER", "RED"]
IntentAction = Literal["ENTER_LONG", "ENTER_SHORT", "EXIT", "REDUCE", "HOLD"]
OrderStatus = Literal["NEW", "SENT", "ACKED", "PARTIAL", "FILLED", "CANCELED", "REJECTED"]
OrderSide = Literal["BUY", "SELL"]

# ============================================================
# Data Contracts
# ============================================================

class Signal(BaseModel):
    """
    Short-horizon trading signal produced by the signal engine.
    This is the first typed object in the pipeline.
    """
    direction: SignalDirection
    confidence: float = Field(..., ge=0.0, le=1.0)
    regime: MarketRegime
    horizon_minutes: int = Field(..., gt=0)
    meta: Dict[str, Any] = {}

class MarketPosture(BaseModel):
    """
    Computed posture of the market, indicating overall health and safety.
    """
    status: Posture
    reasons: list[str] = []

class ExecutionIntent(BaseModel):
    """
    A high-level, idempotent instruction to the OMS.
    This is the "what we want to do" without specifying "how".
    """
    intent_id: str = Field(..., min_length=1)
    action: IntentAction
    symbol: str
    size_fraction: float = Field(..., ge=0.0, le=1.0)
    reason: str
    risk_score: float = Field(..., ge=0.0, le=100.0)

class OrderUpdate(BaseModel):
    """
    An update on the state of a specific order.
    """
    order_id: str
    client_order_id: str
    status: OrderStatus
    filled_quantity: float = 0.0
    average_fill_price: float | None = None

class ExecutionReport(BaseModel):
    """
    A detailed report of a trade execution (a fill).
    This is the primary input for the Portfolio truth engine.
    """
    venue_order_id: str
    fill_id: str
    client_order_id: str
    symbol: str
    side: OrderSide
    quantity: float = Field(..., gt=0)
    price: float = Field(..., gt=0)
    timestamp: int

class PortfolioState(BaseModel):
    """
    A snapshot of the portfolio's state.
    """
    nav: float
    exposure: float
    positions: Dict[str, float] = {}  # Symbol -> quantity
    balances: Dict[str, float] = {}   # Asset -> quantity
    drawdown: float

class AuditEvent(BaseModel):
    """
    An immutable log entry for a significant event in the pipeline.
    """
    event_id: str
    trace_id: str  # e.g., ties back to an intent_id
    event_type: str
    timestamp: int
    payload: Dict[str, Any]
