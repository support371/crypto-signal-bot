-- Migration 018: immutable recovery-accounting plans and approval evidence.
-- Approval does not dispatch accounting commands, apply reservations, mutate a
-- provider, or authorize trading execution.

CREATE TABLE IF NOT EXISTS live_recovery_accounting_plans (
  plan_id TEXT PRIMARY KEY,
  exchange_name TEXT NOT NULL CHECK (exchange_name = 'BITGET'),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  recovery_snapshot_hash TEXT NOT NULL CHECK (length(recovery_snapshot_hash) = 64),
  plan_hash TEXT NOT NULL UNIQUE CHECK (length(plan_hash) = 64),
  command_count INTEGER NOT NULL CHECK (command_count >= 0),
  commands_json TEXT NOT NULL,
  prepared_by_actor_id TEXT NOT NULL,
  accounting_evidence_ready INTEGER NOT NULL DEFAULT 1
    CHECK (accounting_evidence_ready = 1),
  automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (automatically_dispatched = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_account_id, recovery_snapshot_hash)
);

CREATE TABLE IF NOT EXISTS live_recovery_accounting_approval_events (
  approval_event_id TEXT PRIMARY KEY,
  authorization_event_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  actor_id TEXT NOT NULL,
  plan_prepared_by_actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'DENIED')),
  reasons_json TEXT NOT NULL,
  authorization_allowed INTEGER NOT NULL CHECK (authorization_allowed IN (0, 1)),
  matched_roles_json TEXT NOT NULL,
  step_up_session_id TEXT,
  approval_hash TEXT NOT NULL UNIQUE CHECK (length(approval_hash) = 64),
  automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (automatically_dispatched = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES live_recovery_accounting_plans(plan_id),
  FOREIGN KEY (authorization_event_id) REFERENCES live_authorization_events(authorization_event_id)
);

CREATE INDEX IF NOT EXISTS idx_live_recovery_accounting_plans_account_time
  ON live_recovery_accounting_plans(exchange_account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_recovery_accounting_approvals_plan_time
  ON live_recovery_accounting_approval_events(plan_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_plans_no_update
BEFORE UPDATE ON live_recovery_accounting_plans
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_plans cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_plans_no_delete
BEFORE DELETE ON live_recovery_accounting_plans
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_plans cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_approval_events_no_update
BEFORE UPDATE ON live_recovery_accounting_approval_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_approval_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_approval_events_no_delete
BEFORE DELETE ON live_recovery_accounting_approval_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_approval_events cannot be deleted');
END;
