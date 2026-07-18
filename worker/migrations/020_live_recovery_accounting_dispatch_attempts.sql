-- Migration 020: immutable, manually reviewed recovery-accounting dispatch attempts.
-- An attempt only authorizes serialized accounting projection. It never calls an
-- exchange, applies a reservation, retries automatically, or unlocks execution.

CREATE TABLE IF NOT EXISTS live_recovery_accounting_dispatch_attempts (
  dispatch_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  approval_event_id TEXT NOT NULL UNIQUE,
  approval_validity_hash TEXT NOT NULL CHECK (length(approval_validity_hash) = 64),
  predecessor_attempt_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  approved_by_actor_id TEXT NOT NULL,
  plan_prepared_by_actor_id TEXT NOT NULL,
  exchange_name TEXT NOT NULL CHECK (exchange_name = 'BITGET'),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  command_count INTEGER NOT NULL CHECK (command_count >= 0),
  attempt_hash TEXT NOT NULL UNIQUE CHECK (length(attempt_hash) = 64),
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
  claimed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES live_recovery_accounting_plans(plan_id),
  FOREIGN KEY (approval_event_id)
    REFERENCES live_recovery_accounting_approval_events(approval_event_id),
  FOREIGN KEY (approval_event_id)
    REFERENCES live_recovery_accounting_approval_validity(approval_event_id),
  UNIQUE (plan_id, predecessor_attempt_id),
  CHECK (approved_by_actor_id <> plan_prepared_by_actor_id)
);

CREATE INDEX IF NOT EXISTS idx_live_recovery_dispatch_attempts_plan_time
  ON live_recovery_accounting_dispatch_attempts(plan_id, claimed_at);

CREATE TRIGGER IF NOT EXISTS live_recovery_dispatch_attempt_completed_plan_guard
BEFORE INSERT ON live_recovery_accounting_dispatch_attempts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM live_recovery_accounting_dispatches
   WHERE plan_id = NEW.plan_id AND status = 'COMPLETED'
)
BEGIN
  SELECT RAISE(ABORT, 'completed recovery accounting plan cannot be dispatched again');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_dispatch_attempt_genesis_guard
BEFORE INSERT ON live_recovery_accounting_dispatch_attempts
FOR EACH ROW
WHEN NEW.predecessor_attempt_id = 'GENESIS' AND (
  EXISTS (SELECT 1 FROM live_recovery_accounting_dispatches WHERE plan_id = NEW.plan_id)
  OR EXISTS (
    SELECT 1 FROM live_recovery_accounting_dispatch_attempts WHERE plan_id = NEW.plan_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'genesis dispatch attempt is not unique for plan');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_dispatch_attempt_resume_guard
BEFORE INSERT ON live_recovery_accounting_dispatch_attempts
FOR EACH ROW
WHEN NEW.predecessor_attempt_id <> 'GENESIS'
 AND NOT (
   EXISTS (
     SELECT 1
       FROM live_recovery_accounting_dispatch_attempts prior
      WHERE prior.dispatch_id = NEW.predecessor_attempt_id
        AND prior.plan_id = NEW.plan_id
        AND prior.approval_event_id <> NEW.approval_event_id
        AND prior.dispatch_id = (
          SELECT latest.dispatch_id
            FROM live_recovery_accounting_dispatch_attempts latest
           WHERE latest.plan_id = NEW.plan_id
           ORDER BY latest.claimed_at DESC, latest.dispatch_id DESC
           LIMIT 1
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM live_recovery_accounting_dispatches result
             WHERE result.dispatch_id = prior.dispatch_id
          )
          OR EXISTS (
            SELECT 1 FROM live_recovery_accounting_dispatches result
             WHERE result.dispatch_id = prior.dispatch_id
               AND result.plan_id = NEW.plan_id
               AND result.status IN ('PARTIAL', 'FAILED')
          )
        )
   )
   OR (
     NOT EXISTS (
       SELECT 1 FROM live_recovery_accounting_dispatch_attempts
        WHERE plan_id = NEW.plan_id
     )
     AND EXISTS (
       SELECT 1
         FROM live_recovery_accounting_dispatches legacy
        WHERE legacy.dispatch_id = NEW.predecessor_attempt_id
          AND legacy.plan_id = NEW.plan_id
          AND legacy.status IN ('PARTIAL', 'FAILED')
          AND legacy.approval_event_id <> NEW.approval_event_id
          AND legacy.dispatch_id = (
            SELECT latest.dispatch_id
              FROM live_recovery_accounting_dispatches latest
             WHERE latest.plan_id = NEW.plan_id
             ORDER BY latest.occurred_at DESC, latest.dispatch_id DESC
             LIMIT 1
          )
     )
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'dispatch resume requires the latest failed or partial predecessor and new approval');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_dispatch_attempts_no_update
BEFORE UPDATE ON live_recovery_accounting_dispatch_attempts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_dispatch_attempts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_dispatch_attempts_no_delete
BEFORE DELETE ON live_recovery_accounting_dispatch_attempts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_dispatch_attempts cannot be deleted');
END;
