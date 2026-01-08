"""
Paper trading adapter for the Execution Gateway.
Simulates order execution without connecting to a live exchange.
"""
import random
from datetime import datetime, timezone
import uuid
from backend.execution.gateway import ExecutionGateway
from backend.oms.models import Order
from backend.contracts.schemas import ExecutionReport, OrderStatus, OrderSide

class PaperTradingAdapter(ExecutionGateway):
    """
    Simulates a trading venue for paper trading.
    - It maintains a simple order book.
    - It generates fills based on a simulated market price.
    """
    def __init__(self):
        self._open_orders = {}
        self._market_price = 30000.0  # Simulated market price
        self._update_status_callback = None

    def place_order(self, order: Order, update_status_callback: callable) -> bool:
        """
        Accepts a new order and adds it to the simulated order book.
        The callback is used to simulate an ACK from the exchange.
        """
        print(f"PAPER_TRADER: Placing order {order.client_order_id}")
        self._open_orders[order.client_order_id] = order
        self._update_status_callback = update_status_callback

        # Simulate an immediate ACK by calling back to the OMS
        if self._update_status_callback:
            self._update_status_callback(order.client_order_id, OrderStatus.ACKED)

        return True

    def cancel_order(self, client_order_id: str) -> bool:
        """Removes an order from the simulated order book."""
        if client_order_id in self._open_orders:
            print(f"PAPER_TRADER: Canceling order {client_order_id}")
            del self._open_orders[client_order_id]
            if self._update_status_callback:
                self._update_status_callback(client_order_id, OrderStatus.CANCELED)
            return True
        return False

    def replace_order(self, client_order_id: str, new_price: float, new_qty: float) -> bool:
        """Simulates replacing an order."""
        if client_order_id in self._open_orders:
            print(f"PAPER_TRADER: Replacing order {client_order_id}")
            # In a real system, this would have a new client_order_id
            order = self._open_orders[client_order_id]
            order.price = new_price
            order.quantity = new_qty
            return True
        return False

    def get_open_orders(self) -> list:
        return list(self._open_orders.values())

    def tick(self, new_market_price: float) -> list[ExecutionReport]:
        """
        Simulates a market data update, checks for fills, and returns reports.
        """
        self._market_price = new_market_price
        reports = []
        filled_order_ids = []

        # Iterate over a copy of items, as we may modify the dict during iteration
        for client_order_id, order in list(self._open_orders.items()):
            # Simple fill logic: fill if market crosses the order price.
            # For market orders, price is None, so they fill immediately.
            should_fill = (
                (order.side == OrderSide.BUY and self._market_price <= (order.price or self._market_price)) or
                (order.side == OrderSide.SELL and self._market_price >= (order.price or self._market_price))
            )

            if should_fill:
                print(f"PAPER_TRADER: Generating fill for order {client_order_id}")
                report = ExecutionReport(
                    venue_order_id=f"paper-venue-{uuid.uuid4()}",
                    fill_id=f"paper-fill-{uuid.uuid4()}",
                    client_order_id=client_order_id,
                    symbol=order.symbol,
                    side=order.side,
                    quantity=order.quantity,
                    price=self._market_price, # Fill at the current market price
                    timestamp=int(datetime.now(timezone.utc).timestamp())
                )
                reports.append(report)
                filled_order_ids.append(client_order_id)

        # Remove filled orders from the open order book
        for order_id in filled_order_ids:
            if order_id in self._open_orders:
                del self._open_orders[order_id]

        return reports
