"""
Strict state machine for order status transitions.
"""
from backend.contracts.schemas import OrderStatus

# Defines the valid transitions from a given state.
# Key: current status, Value: set of allowed next statuses.
VALID_TRANSITIONS = {
    OrderStatus.NEW: {OrderStatus.SENT, OrderStatus.CANCELED, OrderStatus.REJECTED},
    OrderStatus.SENT: {OrderStatus.ACKED, OrderStatus.PARTIAL, OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED},
    OrderStatus.ACKED: {OrderStatus.PARTIAL, OrderStatus.FILLED, OrderStatus.CANCELED},
    OrderStatus.PARTIAL: {OrderStatus.PARTIAL, OrderStatus.FILLED, OrderStatus.CANCELED},
    OrderStatus.FILLED: set(),
    OrderStatus.CANCELED: set(),
    OrderStatus.REJECTED: set(),
}

class IllegalStateTransitionError(Exception):
    """Raised when an invalid order status transition is attempted."""
    def __init__(self, current: OrderStatus, attempted: OrderStatus):
        self.current = current
        self.attempted = attempted
        super().__init__(f"Illegal state transition from {current.value} to {attempted.value}")

def assert_valid_transition(current: OrderStatus, next_status: OrderStatus):
    """
    Asserts that a transition from the current to the next status is valid.
    Raises IllegalStateTransitionError if the transition is not allowed.
    """
    if next_status not in VALID_TRANSITIONS.get(current, set()):
        raise IllegalStateTransitionError(current, next_status)
