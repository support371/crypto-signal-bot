"""
Formal intent state machine for order lifecycle management.

States:
    PENDING -> RISK_APPROVED -> SUBMITTED -> FILLED
                                          -> PARTIALLY_FILLED -> FILLED
                                          -> CANCELLED
                                          -> FAILED
    PENDING -> RISK_REJECTED

Valid transitions are enforced. Invalid transitions raise StateTransitionError.
"""

import time
import logging
from typing import Optional

from backend.models.execution_intent import ExecutionIntent, IntentStatus

logger = logging.getLogger("state_machine")

# Valid state transitions map
_VALID_TRANSITIONS = {
    IntentStatus.PENDING: {
        IntentStatus.RISK_APPROVED,
        IntentStatus.RISK_REJECTED,
    },
    IntentStatus.RISK_APPROVED: {
        IntentStatus.SUBMITTED,
        IntentStatus.FAILED,       # e.g., exchange client error before submission
    },
    IntentStatus.RISK_REJECTED: set(),  # terminal
    IntentStatus.SUBMITTED: {
        IntentStatus.FILLED,
        IntentStatus.PARTIALLY_FILLED,
        IntentStatus.CANCELLED,
        IntentStatus.FAILED,
    },
    IntentStatus.PARTIALLY_FILLED: {
        IntentStatus.FILLED,
        IntentStatus.CANCELLED,
        IntentStatus.FAILED,
    },
    IntentStatus.FILLED: set(),       # terminal
    IntentStatus.CANCELLED: set(),    # terminal
    IntentStatus.FAILED: set(),       # terminal
}


class StateTransitionError(Exception):
    """Raised when an invalid state transition is attempted."""
    def __init__(self, current: IntentStatus, target: IntentStatus):
        super().__init__(
            f"Invalid transition: {current.value} -> {target.value}"
        )
        self.current = current
        self.target = target


def transition(
    intent: ExecutionIntent,
    new_status: IntentStatus,
    notes: Optional[str] = None,
    fill_price: Optional[float] = None,
    fill_quantity: Optional[float] = None,
) -> ExecutionIntent:
    """
    Transition an intent to a new status with validation.

    Args:
        intent: The execution intent to transition
        new_status: Target status
        notes: Optional notes to append
        fill_price: Fill price (for FILLED/PARTIALLY_FILLED)
        fill_quantity: Fill quantity (for FILLED/PARTIALLY_FILLED)

    Returns:
        Updated intent (mutated in place)

    Raises:
        StateTransitionError: If the transition is not valid
    """
    current = intent.status
    valid_targets = _VALID_TRANSITIONS.get(current, set())

    if new_status not in valid_targets:
        raise StateTransitionError(current, new_status)

    old_status = intent.status
    intent.status = new_status
    intent.updated_at = time.time()

    if notes:
        intent.notes = notes
    if fill_price is not None:
        intent.fill_price = fill_price
    if fill_quantity is not None:
        intent.fill_quantity = fill_quantity

    logger.info(
        "Intent %s: %s -> %s%s",
        intent.id[:8],
        old_status.value,
        new_status.value,
        f" ({notes})" if notes else "",
    )

    return intent


def is_terminal(status: IntentStatus) -> bool:
    """Check if a status is terminal (no further transitions possible)."""
    return len(_VALID_TRANSITIONS.get(status, set())) == 0


def get_valid_transitions(status: IntentStatus) -> set:
    """Get the set of valid target statuses from the current status."""
    return _VALID_TRANSITIONS.get(status, set())
