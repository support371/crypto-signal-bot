-- Migration 009: at-least-once queue delivery tracking and dead letters.

CREATE TABLE IF NOT EXISTS live_queue_messages (
  event_id TEXT PRIMARY KEY,
  message_type TEXT NOT NULL CHECK (message_type IN (
    'RECONCILE_ACCOUNT',
    'PROCESS_FILL',
    'REFRESH_BALANCES',
    'MONITOR_TRANSFERS',
    'EXPORT_AUDIT',
    'NOTIFY_ALERT'
  )),
  exchange_account_id TEXT,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  last_error_detail TEXT,
  received_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  processing_started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_dead_letter_records (
  dead_letter_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  exchange_account_id TEXT,
  correlation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  final_attempt_count INTEGER NOT NULL CHECK (final_attempt_count > 0),
  error_code TEXT NOT NULL,
  error_detail TEXT,
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES live_queue_messages(event_id),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_live_queue_status_available
  ON live_queue_messages(status, available_at, message_type);

CREATE INDEX IF NOT EXISTS idx_live_queue_account_status
  ON live_queue_messages(exchange_account_id, status, updated_at);

CREATE TRIGGER IF NOT EXISTS live_dead_letter_records_no_update
BEFORE UPDATE ON live_dead_letter_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_dead_letter_records cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_dead_letter_records_no_delete
BEFORE DELETE ON live_dead_letter_records
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_dead_letter_records cannot be deleted');
END;
