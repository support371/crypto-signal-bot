-- Migration 014: immutable candidate assessment and reservation-draft evidence.
-- This schema records evidence only. It cannot apply a reservation or authorize
-- exchange execution. Account identifiers are evidence references and do not
-- require an account projection to exist first.

CREATE TABLE IF NOT EXISTS live_candidate_assessments (
  assessment_id TEXT PRIMARY KEY,
  internal_order_id TEXT NOT NULL,
  exchange_account_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('BTCC', 'BITGET')),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  preview_hash TEXT NOT NULL CHECK (length(preview_hash) = 64),
  evidence_hash TEXT NOT NULL UNIQUE CHECK (length(evidence_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('REJECTED', 'READY_BUT_EXECUTION_LOCKED')),
  operational_checks_passed INTEGER NOT NULL CHECK (operational_checks_passed IN (0, 1)),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  preview_json TEXT NOT NULL,
  risk_decision_json TEXT,
  reasons_json TEXT NOT NULL,
  coordinator_id TEXT NOT NULL,
  coordinator_sequence INTEGER NOT NULL CHECK (coordinator_sequence > 0),
  committed_at TEXT NOT NULL,
  projected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_account_id, internal_order_id),
  UNIQUE (coordinator_id, coordinator_sequence)
);

CREATE TABLE IF NOT EXISTS live_candidate_reservation_drafts (
  reservation_journal_id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  internal_order_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  available_account_id TEXT NOT NULL,
  reserved_account_id TEXT NOT NULL,
  journal_hash TEXT NOT NULL UNIQUE CHECK (length(journal_hash) = 64),
  journal_json TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied = 0),
  committed_at TEXT NOT NULL,
  projected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assessment_id) REFERENCES live_candidate_assessments(assessment_id)
);

CREATE TABLE IF NOT EXISTS live_candidate_projection_receipts (
  projection_event_id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL UNIQUE,
  coordinator_id TEXT NOT NULL,
  coordinator_sequence INTEGER NOT NULL CHECK (coordinator_sequence > 0),
  payload_hash TEXT NOT NULL UNIQUE CHECK (length(payload_hash) = 64),
  projection_status TEXT NOT NULL DEFAULT 'PROJECTED'
    CHECK (projection_status = 'PROJECTED'),
  projected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assessment_id) REFERENCES live_candidate_assessments(assessment_id),
  UNIQUE (coordinator_id, coordinator_sequence)
);

CREATE INDEX IF NOT EXISTS idx_live_candidate_assessments_account_time
  ON live_candidate_assessments(exchange_account_id, committed_at);

CREATE INDEX IF NOT EXISTS idx_live_candidate_assessments_status_time
  ON live_candidate_assessments(status, committed_at);

CREATE TRIGGER IF NOT EXISTS live_candidate_assessments_no_update
BEFORE UPDATE ON live_candidate_assessments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_candidate_assessments cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_candidate_assessments_no_delete
BEFORE DELETE ON live_candidate_assessments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_candidate_assessments cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_candidate_reservation_drafts_no_update
BEFORE UPDATE ON live_candidate_reservation_drafts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_candidate_reservation_drafts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_candidate_reservation_drafts_no_delete
BEFORE DELETE ON live_candidate_reservation_drafts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_candidate_reservation_drafts cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_candidate_projection_receipts_no_update
BEFORE UPDATE ON live_candidate_projection_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_candidate_projection_receipts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_candidate_projection_receipts_no_delete
BEFORE DELETE ON live_candidate_projection_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_candidate_projection_receipts cannot be deleted');
END;
