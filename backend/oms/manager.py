"""
The core Order Management System (OMS) service.
"""
from typing import Dict, Optional, List
from datetime import datetime, timezone, timedelta
from backend.contracts.schemas import ExecutionIntent, OrderUpdate, OrderStatus, ExecutionReport
from backend.oms.models import Order
from backend.oms.state_machine import assert_valid_transition
from backend.oms.idempotency import IdempotencyStore, IdempotencyError

class OrderManagementSystem:
    def __init__(self, supabase_client):
        self._orders: Dict[str, Order] = {} # In-memory store, keyed by client_order_id
        self._idempotency_store = IdempotencyStore()
        self._supabase = supabase_client

    def submit_intent(self, intent: ExecutionIntent) -> Order:
        """
        Submits an execution intent to the OMS.
        - Checks for idempotency.
        - Creates a new order.
        - Returns the newly created order.
        """
        if intent.action == "HOLD":
            # This should ideally be filtered before reaching OMS, but as a safeguard:
            raise ValueError("Cannot create an order for a HOLD intent.")

        try:
            # This will raise IdempotencyError if intent_id is already processed
            new_order = Order(
                intent_id=intent.intent_id,
                symbol=intent.symbol,
                quantity=intent.size_fraction, # Note: This is a fraction, needs to be converted to absolute size
                action=intent.action
            )
            self._idempotency_store.check_and_store(intent.intent_id, new_order.client_order_id)
            self._orders[new_order.client_order_id] = new_order

            # Persist to DB
            self._save_order_to_db(new_order)
            return new_order
        except IdempotencyError:
            # If intent was already processed, find and return the existing order
            client_order_id = self._idempotency_store.get_order_id(intent.intent_id)
            return self._orders.get(client_order_id)
        except ValueError as e:
            # Handle cases like HOLD intents
            print(f"Error submitting intent: {e}") # Or use proper logging
            return None


    def on_execution_report(self, report: ExecutionReport):
        """
        Processes an execution report from the execution gateway.
        Updates the state of the corresponding order.
        """
        order = self._orders.get(report.client_order_id)
        if not order:
            # Handle orphan execution reports (e.g., from a previous session)
            return

        # Simple fill logic for now
        order.filled_quantity = report.quantity
        order.average_fill_price = report.price
        self.update_order_status(order.client_order_id, OrderStatus.FILLED)

    def update_order_status(self, client_order_id: str, new_status: OrderStatus):
        """
        Updates the status of an order, enforcing state transitions.
        """
        order = self._orders.get(client_order_id)
        if not order:
            return

        assert_valid_transition(order.status, new_status)
        order.status = new_status
        order.updated_at = datetime.now(timezone.utc)
        self._update_order_in_db(order)

    def get_open_orders(self) -> List[Order]:
        """Returns a list of all orders that are not in a final state."""
        return [o for o in self._orders.values() if o.is_open()]

    def _save_order_to_db(self, order: Order):
        """Saves a new order to the Supabase 'orders' table."""
        try:
            data, count = self._supabase.table('orders').insert(
                {
                    "order_id": order.order_id,
                    "client_order_id": order.client_order_id,
                    "intent_id": order.intent_id,
                    "symbol": order.symbol,
                    "side": order.side.value,
                    "quantity": order.quantity,
                    "status": order.status.value,
                    "created_at": order.created_at.isoformat(),
                    "updated_at": order.updated_at.isoformat(),
                }
            ).execute()
        except Exception as e:
            print(f"Error saving order to DB: {e}")

    def _update_order_in_db(self, order: Order):
        """Updates an existing order in the Supabase 'orders' table."""
        try:
            data, count = self._supabase.table('orders').update(
                {
                    "status": order.status.value,
                    "filled_quantity": order.filled_quantity,
                    "average_fill_price": order.average_fill_price,
                    "updated_at": order.updated_at.isoformat(),
                }
            ).eq('client_order_id', order.client_order_id).execute()
        except Exception as e:
            print(f"Error updating order in DB: {e}")
