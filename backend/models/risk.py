"""
Risk context model for the execution gateway.
"""

from typing import Optional
from pydantic import BaseModel


class RiskContext(BaseModel):
    symbol: str
    side: str
    quantity: float
    price: Optional[float] = None
    current_position_value: float = 0.0
    daily_pnl: float = 0.0
    account_balance: float = 10000.0
    volatility_24h: float = 0.0
