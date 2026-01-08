"""
Internal data models for the Order Management System.
"""
from typing import Optional
from dataclasses import dataclass, field
import uuid
from datetime import datetime, timezone
from backend.contracts.schemas import OrderStatus, OrderSide, IntentAction

@dataclass
class Order:
    """
    Represents the internal state of an order within the OMS.
    """
    # --- Fields without defaults ---
    intent_id: str
    symbol: str
    quantity: float
    action: IntentAction

    # --- Fields with defaults ---
    # Core Identifiers
    order_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    client_order_id: str = field(default_factory=lambda: f"lovable-{uuid.uuid4()}")

    # Order Parameters
    side: OrderSide = None # Derived in __post_init__
    price: Optional[float] = None  # None for market orders

    # State Management
    status: OrderStatus = OrderStatus.NEW
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Fill Information
    filled_quantity: float = 0.0
    average_fill_price: Optional[float] = None

    # Link to originating action

    def __post_init__(self):
        # Ensure side is derived correctly from action
        if self.action in [IntentAction.ENTER_LONG]:
            self.side = OrderSide.BUY
        elif self.action in [IntentAction.EXIT, IntentAction.REDUCE, IntentAction.ENTER_SHORT]:
            self.side = OrderSide.SELL
        else:
            # Should not happen if intent is validated
            raise ValueError(f"Cannot determine OrderSide from action: {self.action}")

    def is_closed(self) -> bool:
        return self.status in [OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED]

    def is_open(self) -> bool:
        return not self.is_closed()
