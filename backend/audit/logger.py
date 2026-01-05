"""
Audit Log Engine
"""
import uuid
import time
from typing import List
from backend.contracts.schemas import AuditEvent
from backend.supabase_client import supabase

class AuditLogger:
    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.log: List[AuditEvent] = []

    def log_event(self, trace_id: str, event_type: str, payload: dict):
        event = AuditEvent(
            event_id=f"evt_{uuid.uuid4()}",
            trace_id=trace_id,
            event_type=event_type,
            timestamp=int(time.time()),
            payload=payload
        )
        self.log.append(event)
        self.supabase.table("audit_events").insert(event.model_dump()).execute()
