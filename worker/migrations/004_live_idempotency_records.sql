-- Migration 004: durable idempotency records for financial mutations.
-- This migration creates no executable live path and seeds no mutation records.

CREATE TABLE IF NOT EXISTS idempotency_records (
  operation_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  operation_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CLAIMED'
    CHECK (status IN (
      'CLAIMED',
      'IN_PROGRESS',
      'SUCCEEDED',
      'FAILED',
      'RECOVERY_REQUIRED'
    )),
  response_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  PRIMARY KEY (operation_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_operation_id
  ON idempotency_records(operation_id);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_account_status
  ON idempotency_records(exchange_account_id, status, updated_at);

CREATE TRIGGER IF NOT EXISTS idempotency_records_updated_at
AFTER UPDATE ON idempotency_records
FOR EACH ROW
BEGIN
  UPDATE idempotency_records
     SET updated_at = CURRENT_TIMESTAMP
   WHERE operation_scope = OLD.operation_scope
     AND idempotency_key = OLD.idempotency_key;
END;
