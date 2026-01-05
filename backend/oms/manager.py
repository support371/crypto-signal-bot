"""
Order Management System (OMS)
"""
import uuid
from typing import Dict
from pydantic import BaseModel, Field
from backend.contracts.schemas import ExecutionIntent, OrderStatus
from backend.supabase_client import supabase

class Order(BaseModel):
    order_id: str = Field(default_factory=lambda: f"ord_{uuid.uuid4()}")
    intent_id: str
    client_order_id: str = Field(default_factory=lambda: f"cli_{uuid.uuid4()}")
    status: OrderStatus = "NEW"

class OrderManagementSystem:
    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.idempotency_store: Dict[str, Order] = {}
        self.orders: Dict[str, Order] = {}

    def submit_intent(self, intent: ExecutionIntent) -> Order:
        if intent.intent_id in self.idempotency_store:
            return self.idempotency_store[intent.intent_id]

        if intent.action == "HOLD":
            placeholder_order = Order(intent_id=intent.intent_id, status="CANCELED")
            self.idempotency_store[intent.intent_id] = placeholder_order
            return placeholder_order

        new_order = Order(intent_id=intent.intent_id)

        self.idempotency_store[intent.intent_id] = new_order
        self.orders[new_order.order_id] = new_order

        # Persist to Supabase
        self.supabase.table("execution_intents").insert(intent.model_dump()).execute()
        self.supabase.table("orders").insert(new_order.model_dump()).execute()

        return new_order

    def update_order_status(self, order_id: str, new_status: OrderStatus):
        if order_id not in self.orders:
            raise ValueError(f"Order '{order_id}' not found.")

        order = self.orders[order_id]
        current_status = order.status

        legal_transitions: Dict[OrderStatus, set[OrderStatus]] = {
            "NEW": {"SENT", "CANCELED"},
            "SENT": {"ACKED", "REJECTED", "CANCELED"},
            "ACKED": {"PARTIAL", "FILLED", "CANCELED"},
            "PARTIAL": {"FILLED", "CANCELED"},
            "FILLED": set(),
            "CANCELED": set(),
            "REJECTED": set(),
        }

        if new_status not in legal_transitions[current_status]:
            raise ValueError(f"Illegal state transition from {current_status} to {new_status} for order '{order_id}'.")

        order.status = new_status
        self.supabase.table("orders").update({"status": new_status}).eq("order_id", order_id).execute()
