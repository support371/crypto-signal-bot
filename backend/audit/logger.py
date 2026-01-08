"""
Append-only audit logger for critical system events.
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, Any

class AuditLogger:
    def __init__(self, supabase_client):
        self._supabase = supabase_client

    def log_event(self, trace_id: str, event_type: str, payload: Dict[str, Any]):
        """
        Logs a new event to the audit trail.

        Args:
            trace_id: A unique identifier (e.g., intent_id) to link related events.
            event_type: A string describing the type of event (e.g., "SIGNAL_GENERATED").
            payload: A dictionary containing the details of the event.
        """
        event = {
            "event_id": str(uuid.uuid4()),
            "trace_id": trace_id,
            "event_type": event_type,
            "timestamp": int(datetime.now(timezone.utc).timestamp()),
            "payload": payload,
        }

        try:
            # In a real system, you might want to handle failures gracefully,
            # e.g., by logging to a file as a fallback.
            data, count = self._supabase.table('audit_events').insert(event).execute()
            print(f"AUDIT :: {event_type} :: {trace_id}")
        except Exception as e:
            print(f"FATAL: Could not write to audit log: {e}")
