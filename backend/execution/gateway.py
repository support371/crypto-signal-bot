"""
Execution Gateway and Exchange Adapters
"""
from typing import Protocol, Literal
from backend.oms.manager import Order

ErrorType = Literal["TRANSIENT", "PERMANENT", "RISK"]

class ExecutionGateway(Protocol):
    def place_order(self, order: Order) -> bool:
        ...
    def cancel_order(self, order: Order) -> bool:
        ...

class StubBitgetAdapter:
    def place_order(self, order: Order) -> bool:
        print(f"STUB: Placing order {order.order_id} on Bitget.")
        return True

    def cancel_order(self, order: Order) -> bool:
        print(f"STUB: Canceling order {order.order_id} on Bitget.")
        return True

def get_execution_gateway(venue_id: str) -> ExecutionGateway:
    if venue_id == "bitget":
        return StubBitgetAdapter()
    raise ValueError(f"Unknown venue: {venue_id}")
