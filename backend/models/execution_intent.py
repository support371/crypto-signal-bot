"""
Execution intent model and associated enums for the trading backend.
"""

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
import uuid
import time


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


class TimeInForce(str, Enum):
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"


class IntentStatus(str, Enum):
    PENDING = "PENDING"
    RISK_APPROVED = "RISK_APPROVED"
    RISK_REJECTED = "RISK_REJECTED"
    SUBMITTED = "SUBMITTED"
    FILLED = "FILLED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


class ExecutionIntent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    symbol: str
    side: Side
    order_type: OrderType = OrderType.MARKET
    quantity: float
    price: Optional[float] = None
    time_in_force: TimeInForce = TimeInForce.GTC
    status: IntentStatus = IntentStatus.PENDING
    notes: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    fill_price: Optional[float] = None
    fill_quantity: Optional[float] = None
    mode: str = "paper"


class IntentRequest(BaseModel):
    symbol: str = "BTCUSDT"
    side: Side = Side.BUY
    order_type: OrderType = OrderType.MARKET
    quantity: float = 0.001
    price: Optional[float] = None
    time_in_force: TimeInForce = TimeInForce.GTC


class IntentResponse(BaseModel):
    id: str
    status: str
    notes: Optional[str] = None
