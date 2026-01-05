"""
Unit tests for the Audit Logger.
"""
import pytest
from unittest.mock import MagicMock
from backend.audit.logger import AuditLogger

def test_log_event():
    logger = AuditLogger(supabase_client=MagicMock())
    logger.log_event("trace1", "TEST_EVENT", {"data": "test"})

    assert len(logger.log) == 1
    event = logger.log[0]
    assert event.trace_id == "trace1"
    assert event.event_type == "TEST_EVENT"
    assert event.payload == {"data": "test"}
