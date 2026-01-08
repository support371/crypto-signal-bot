"""
Execution Gateway interface and factory.
"""
from abc import ABC, abstractmethod
from backend.oms.models import Order
from backend.contracts.schemas import ExecutionReport

class ExecutionGateway(ABC):
    """
    Abstract base class for all execution adapters.
    Defines the interface for placing, canceling, and replacing orders.
    """
    @abstractmethod
    def place_order(self, order: Order, update_status_callback: callable) -> bool:
        """
        Submits a new order to the execution venue.
        The callback is used by the adapter to provide asynchronous status updates (e.g., ACK).
        Returns True if the order was accepted for processing.
        """
        pass

    @abstractmethod
    def cancel_order(self, client_order_id: str) -> bool:
        """
        Cancels an existing order.
        Returns True if the cancel request was accepted.
        """
        pass

    @abstractmethod
    def replace_order(self, client_order_id: str, new_price: float, new_qty: float) -> bool:
        """
        Replaces an existing order with new parameters.
        Returns True if the replace request was accepted.
        """
        pass

    @abstractmethod
    def get_open_orders(self) -> list:
        """
        Retrieves the current state of open orders from the venue.
        """
        pass

# --- Stubbed Live Adapter ---
class StubBitgetAdapter(ExecutionGateway):
    """A placeholder for a real Bitget adapter, which is disabled."""
    def place_order(self, order: Order, update_status_callback: callable) -> bool:
        print("LIVE TRADING DISABLED: Bitget order placement is not implemented.")
        # In a real scenario, you would start a task to watch this order
        # and use the callback for status updates.
        return False

    def cancel_order(self, client_order_id: str) -> bool:
        print("LIVE TRADING DISABLED: Bitget order cancellation is not implemented.")
        return False

    def replace_order(self, client_order_id: str, new_price: float, new_qty: float) -> bool:
        print("LIVE TRADING DISABLED: Bitget order replacement is not implemented.")
        return False

    def get_open_orders(self) -> list:
        return []

# Will be fleshed out in the next step
from .paper_adapter import PaperTradingAdapter

# --- Factory ---
_gateways = {
    "paper": PaperTradingAdapter(),
    "bitget": StubBitgetAdapter(),
}

def get_execution_gateway(venue_id: str) -> ExecutionGateway:
    """
    Factory function to get the execution gateway for a specific venue.
    """
    gateway = _gateways.get(venue_id.lower())
    if not gateway:
        raise ValueError(f"No execution gateway found for venue: {venue_id}")
    return gateway
