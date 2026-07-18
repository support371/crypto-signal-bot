-- Migration 026: immutable fresh-control and read-only recovery evidence for
-- the source-only Bitget demo certification runner. These tables cannot
-- authorize live/mainnet execution, real-funds movement, withdrawals,
-- provider mutation, accounting dispatch, or automatic retry.

CREATE TABLE IF NOT EXISTS live_bitget_demo_control_verifications (
  dispatch_attempt_id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  operation TEXT NOT NULL CHECK (operation IN ('PLACE', 'CANCEL', 'CANCEL_REPLACE')),
  product_symbol TEXT NOT NULL,
  claim_hash TEXT NOT NULL UNIQUE CHECK (length(claim_hash) = 64),
  guardian_evidence_hash TEXT NOT NULL CHECK (length(guardian_evidence_hash) = 64),
  risk_evidence_hash TEXT NOT NULL CHECK (length(risk_evidence_hash) = 64),
  idempotency_evidence_hash TEXT NOT NULL CHECK (length(idempotency_evidence_hash) = 64),
  verified_at TEXT NOT NULL,
  verification_hash TEXT NOT NULL UNIQUE CHECK (length(verification_hash) = 64),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO' CHECK (environment = 'BITGET_DEMO'),
  guardian_clear INTEGER NOT NULL DEFAULT 1 CHECK (guardian_clear = 1),
  risk_approved INTEGER NOT NULL DEFAULT 1 CHECK (risk_approved = 1),
  idempotency_claimed INTEGER NOT NULL DEFAULT 1 CHECK (idempotency_claimed = 1),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0 CHECK (automatically_retried = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dispatch_attempt_id)
    REFERENCES live_bitget_demo_dispatch_claims(dispatch_attempt_id),
  FOREIGN KEY (authorization_id)
    REFERENCES live_bitget_demo_dispatch_authorizations(authorization_id)
);

CREATE TABLE IF NOT EXISTS live_bitget_demo_recovery_attempts (
  recovery_attempt_id TEXT PRIMARY KEY,
  dispatch_attempt_id TEXT NOT NULL UNIQUE,
  authorization_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  result_hash TEXT NOT NULL UNIQUE CHECK (length(result_hash) = 64),
  lookup_plan_hash TEXT NOT NULL CHECK (length(lookup_plan_hash) = 64),
  lookup_count INTEGER NOT NULL CHECK (lookup_count >= 1 AND lookup_count <= 2),
  requested_at TEXT NOT NULL,
  attempt_hash TEXT NOT NULL UNIQUE CHECK (length(attempt_hash) = 64),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO' CHECK (environment = 'BITGET_DEMO'),
  one_shot INTEGER NOT NULL DEFAULT 1 CHECK (one_shot = 1),
  read_only INTEGER NOT NULL DEFAULT 1 CHECK (read_only = 1),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  accounting_automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (accounting_automatically_dispatched = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0 CHECK (automatically_retried = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dispatch_attempt_id)
    REFERENCES live_bitget_demo_dispatch_results(dispatch_attempt_id),
  FOREIGN KEY (authorization_id)
    REFERENCES live_bitget_demo_dispatch_authorizations(authorization_id)
);

CREATE TABLE IF NOT EXISTS live_bitget_demo_recovery_receipts (
  recovery_attempt_id TEXT PRIMARY KEY,
  dispatch_attempt_id TEXT NOT NULL UNIQUE,
  authorization_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  recovery_id TEXT NOT NULL UNIQUE,
  result_hash TEXT NOT NULL UNIQUE CHECK (length(result_hash) = 64),
  lookup_plan_hash TEXT NOT NULL CHECK (length(lookup_plan_hash) = 64),
  lookup_count INTEGER NOT NULL CHECK (lookup_count >= 1 AND lookup_count <= 2),
  status TEXT NOT NULL CHECK (status IN ('RECOVERED', 'INCOMPLETE')),
  snapshot_hash TEXT CHECK (snapshot_hash IS NULL OR length(snapshot_hash) = 64),
  observed_at TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE CHECK (length(receipt_hash) = 64),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO' CHECK (environment = 'BITGET_DEMO'),
  read_only INTEGER NOT NULL DEFAULT 1 CHECK (read_only = 1),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  accounting_automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (accounting_automatically_dispatched = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0 CHECK (automatically_retried = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recovery_attempt_id)
    REFERENCES live_bitget_demo_recovery_attempts(recovery_attempt_id),
  FOREIGN KEY (dispatch_attempt_id)
    REFERENCES live_bitget_demo_recovery_attempts(dispatch_attempt_id),
  CHECK ((status = 'RECOVERED' AND snapshot_hash IS NOT NULL)
      OR (status = 'INCOMPLETE' AND snapshot_hash IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_control_verifications_account_time
  ON live_bitget_demo_control_verifications(exchange_account_id, verified_at);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_recovery_attempts_account_time
  ON live_bitget_demo_recovery_attempts(exchange_account_id, requested_at);

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_control_requires_exact_claim
BEFORE INSERT ON live_bitget_demo_control_verifications
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM live_bitget_demo_dispatch_claims claim
    JOIN live_bitget_demo_dispatch_authorizations authorization
      ON authorization.authorization_id = claim.authorization_id
     AND authorization.dispatch_attempt_id = claim.dispatch_attempt_id
   WHERE claim.dispatch_attempt_id = NEW.dispatch_attempt_id
     AND claim.authorization_id = NEW.authorization_id
     AND claim.exchange_account_id = NEW.exchange_account_id
     AND claim.candidate_hash = NEW.candidate_hash
     AND claim.claim_hash = NEW.claim_hash
     AND authorization.operation = NEW.operation
     AND authorization.product_symbol = NEW.product_symbol
     AND authorization.guardian_evidence_hash = NEW.guardian_evidence_hash
     AND authorization.risk_evidence_hash = NEW.risk_evidence_hash
     AND authorization.idempotency_evidence_hash = NEW.idempotency_evidence_hash
     AND claim.claimed_at <= NEW.verified_at
     AND authorization.valid_from <= NEW.verified_at
     AND NEW.verified_at < authorization.expires_at
)
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo control verification does not match immutable claim');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_result_requires_control_verification
BEFORE INSERT ON live_bitget_demo_dispatch_results
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM live_bitget_demo_control_verifications verification
   WHERE verification.dispatch_attempt_id = NEW.dispatch_attempt_id
     AND verification.authorization_id = NEW.authorization_id
     AND verification.exchange_account_id = NEW.exchange_account_id
     AND verification.candidate_hash = NEW.candidate_hash
     AND verification.operation = NEW.operation
     AND verification.verified_at <= NEW.occurred_at
)
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo result requires immutable fresh-control verification');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_attempt_requires_result
BEFORE INSERT ON live_bitget_demo_recovery_attempts
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM live_bitget_demo_dispatch_results result
   WHERE result.dispatch_attempt_id = NEW.dispatch_attempt_id
     AND result.authorization_id = NEW.authorization_id
     AND result.exchange_account_id = NEW.exchange_account_id
     AND result.candidate_hash = NEW.candidate_hash
     AND result.result_hash = NEW.result_hash
     AND result.requires_read_only_recovery = 1
     AND result.recovery_lookup_count = NEW.lookup_count
     AND result.occurred_at <= NEW.requested_at
)
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo recovery attempt requires exact ambiguous result');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_receipt_requires_attempt
BEFORE INSERT ON live_bitget_demo_recovery_receipts
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM live_bitget_demo_recovery_attempts attempt
   WHERE attempt.recovery_attempt_id = NEW.recovery_attempt_id
     AND attempt.dispatch_attempt_id = NEW.dispatch_attempt_id
     AND attempt.authorization_id = NEW.authorization_id
     AND attempt.exchange_account_id = NEW.exchange_account_id
     AND attempt.candidate_hash = NEW.candidate_hash
     AND attempt.result_hash = NEW.result_hash
     AND attempt.lookup_plan_hash = NEW.lookup_plan_hash
     AND attempt.lookup_count = NEW.lookup_count
     AND attempt.requested_at <= NEW.observed_at
)
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo recovery receipt does not match immutable one-shot attempt');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_control_verifications_no_update
BEFORE UPDATE ON live_bitget_demo_control_verifications
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_control_verifications cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_control_verifications_no_delete
BEFORE DELETE ON live_bitget_demo_control_verifications
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_control_verifications cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_attempts_no_update
BEFORE UPDATE ON live_bitget_demo_recovery_attempts
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_recovery_attempts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_attempts_no_delete
BEFORE DELETE ON live_bitget_demo_recovery_attempts
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_recovery_attempts cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_receipts_no_update
BEFORE UPDATE ON live_bitget_demo_recovery_receipts
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_recovery_receipts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_receipts_no_delete
BEFORE DELETE ON live_bitget_demo_recovery_receipts
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_recovery_receipts cannot be deleted');
END;
