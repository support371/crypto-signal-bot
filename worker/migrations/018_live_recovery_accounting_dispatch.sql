-- Migration 018: immutable operator-approved recovery accounting dispatches.
-- Dispatch invokes accounting persistence only. It never calls an exchange,
-- applies reservations, retries automatically, or authorizes trading execution.

CREATE TABLE IF NOT EXISTS live_recovery_accounting_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  approval_event_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'PARTIAL', 'FAILED')),
  command_count INTEGER NOT NULL CHECK (command_count >= 0),
  completed_command_count INTEGER NOT NULL CHECK (
    completed_command_count >= 0 AND completed_command_count <= command_count
  ),
  failed_command_index INTEGER CHECK (failed_command_index IS NULL OR failed_command_index >= 0),
  failed_fill_id TEXT,
  failure_code TEXT,
  dispatch_hash TEXT NOT NULL UNIQUE CHECK (length(dispatch_hash) = 64),
  operator_approved INTEGER NOT NULL DEFAULT 1 CHECK (operator_approved = 1),
  automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (automatically_dispatched = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0
    CHECK (automatically_retried = 0),
  requires_coordinator_serialization INTEGER NOT NULL DEFAULT 1
    CHECK (requires_coordinator_serialization = 1),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES live_recovery_accounting_plans(plan_id),
  FOREIGN KEY (approval_event_id)
    REFERENCES live_recovery_accounting_approval_events(approval_event_id)
);

CREATE TABLE IF NOT EXISTS live_recovery_accounting_dispatch_receipts (
  dispatch_id TEXT NOT NULL,
  command_index INTEGER NOT NULL CHECK (command_index >= 0),
  fill_id TEXT NOT NULL,
  result_status TEXT NOT NULL CHECK (result_status IN ('PROJECTED', 'REPLAYED')),
  accounting_receipt_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  accounting_hash TEXT NOT NULL CHECK (length(accounting_hash) = 64),
  position_quantity TEXT NOT NULL,
  cumulative_realized_pnl_quote TEXT NOT NULL,
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dispatch_id, command_index),
  UNIQUE (dispatch_id, fill_id),
  FOREIGN KEY (dispatch_id) REFERENCES live_recovery_accounting_dispatches(dispatch_id),
  FOREIGN KEY (accounting_receipt_id)
    REFERENCES live_fill_accounting_receipts(accounting_receipt_id),
  FOREIGN KEY (journal_id) REFERENCES ledger_journals(journal_id)
);

CREATE INDEX IF NOT EXISTS idx_live_recovery_dispatches_plan_time
  ON live_recovery_accounting_dispatches(plan_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_live_recovery_dispatch_receipts_fill
  ON live_recovery_accounting_dispatch_receipts(fill_id, dispatch_id);

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_dispatches_no_update
BEFORE UPDATE ON live_recovery_accounting_dispatches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_dispatches cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_dispatches_no_delete
BEFORE DELETE ON live_recovery_accounting_dispatches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_dispatches cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_dispatch_receipts_no_update
BEFORE UPDATE ON live_recovery_accounting_dispatch_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_dispatch_receipts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_dispatch_receipts_no_delete
BEFORE DELETE ON live_recovery_accounting_dispatch_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_dispatch_receipts cannot be deleted');
END;
