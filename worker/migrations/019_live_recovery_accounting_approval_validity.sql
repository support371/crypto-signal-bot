-- Migration 019: time-bound recovery-accounting approval validity.
-- Validity is independent immutable evidence. It does not dispatch commands,
-- retry automatically, mutate an exchange, apply reservations, or unlock trade.

CREATE TABLE IF NOT EXISTS live_recovery_accounting_approval_validity (
  approval_event_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > valid_from),
  validity_seconds INTEGER NOT NULL CHECK (
    validity_seconds >= 1 AND validity_seconds <= 900
  ),
  validity_hash TEXT NOT NULL UNIQUE CHECK (length(validity_hash) = 64),
  operator_approved INTEGER NOT NULL DEFAULT 1 CHECK (operator_approved = 1),
  automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (automatically_dispatched = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0
    CHECK (automatically_retried = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (approval_event_id)
    REFERENCES live_recovery_accounting_approval_events(approval_event_id),
  FOREIGN KEY (plan_id) REFERENCES live_recovery_accounting_plans(plan_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_recovery_one_completed_dispatch_per_plan
  ON live_recovery_accounting_dispatches(plan_id)
  WHERE status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_live_recovery_approval_validity_expiry
  ON live_recovery_accounting_approval_validity(expires_at);

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_approval_validity_no_update
BEFORE UPDATE ON live_recovery_accounting_approval_validity
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_approval_validity cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_approval_validity_no_delete
BEFORE DELETE ON live_recovery_accounting_approval_validity
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_approval_validity cannot be deleted');
END;
