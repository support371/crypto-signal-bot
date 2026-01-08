"""
Handles idempotency for intent submissions to prevent duplicate orders.
"""
from typing import Dict, Optional

class IdempotencyError(Exception):
    """Raised when a duplicate intent_id is processed."""
    pass

class IdempotencyStore:
    """
    In-memory store to track processed intent_ids and link them to order_ids.
    In a production system, this would be backed by a persistent store like Redis or a database.
    """
    def __init__(self):
        self._intent_to_order: Dict[str, str] = {}

    def check_and_store(self, intent_id: str, order_id: str):
        """
        Checks if an intent_id has been processed. If not, stores it.
        If the intent_id already exists, raises an IdempotencyError.

        Args:
            intent_id: The unique identifier for the execution intent.
            order_id: The unique identifier for the order created from the intent.

        Raises:
            IdempotencyError: If the intent_id has already been processed.
        """
        if intent_id in self._intent_to_order:
            existing_order_id = self._intent_to_order[intent_id]
            raise IdempotencyError(
                f"Intent {intent_id} has already been processed with order_id {existing_order_id}"
            )
        self._intent_to_order[intent_id] = order_id

    def get_order_id(self, intent_id: str) -> Optional[str]:
        """
        Retrieves the order_id associated with a given intent_id.

        Returns:
            The order_id if the intent has been processed, otherwise None.
        """
        return self._intent_to_order.get(intent_id)
