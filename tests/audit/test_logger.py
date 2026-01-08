"""
Unit tests for the Audit Logger.
"""
import pytest
from unittest.mock import MagicMock
from backend.audit.logger import AuditLogger

def test_log_event():
    mock_client = MagicMock()
    mock_client.table.return_value.insert.return_value.execute.return_value = (None, 1)

    logger = AuditLogger(supabase_client=mock_client)
    logger.log_event("trace1", "TEST_EVENT", {"data": "test"})

    # Assert that the insert method was called on the mock client
    mock_client.table('audit_events').insert.assert_called_once()

    # Optional: You can also assert on the payload that was passed to insert
    call_args, call_kwargs = mock_client.table('audit_events').insert.call_args
    event_payload = call_args[0]
    assert event_payload['trace_id'] == 'trace1'
    assert event_payload['event_type'] == 'TEST_EVENT'
    assert event_payload['payload'] == {"data": "test"}
