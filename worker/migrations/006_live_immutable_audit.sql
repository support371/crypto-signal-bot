-- Migration 006: immutable, hash-chained audit events.
-- UPDATE and DELETE are prohibited by database triggers.
-- A unique predecessor constraint prevents two events from forking one chain.

CREATE TABLE IF NOT EXISTS immutable_audit_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  configuration_version TEXT NOT NULL,
  release_id TEXT,
  outcome TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  previous_event_hash TEXT NOT NULL DEFAULT 'GENESIS'
    CHECK (previous_event_hash = 'GENESIS' OR length(previous_event_hash) = 64),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_account_id, previous_event_hash)
);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_account_sequence
  ON immutable_audit_events(exchange_account_id, sequence_id);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_resource
  ON immutable_audit_events(resource_type, resource_id, sequence_id);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_correlation
  ON immutable_audit_events(correlation_id, sequence_id);

CREATE TRIGGER IF NOT EXISTS immutable_audit_events_no_update
BEFORE UPDATE ON immutable_audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'immutable_audit_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS immutable_audit_events_no_delete
BEFORE DELETE ON immutable_audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'immutable_audit_events cannot be deleted');
END;
