-- Migration 027: immutable source mappings for fresh Bitget demo controls.
--
-- This table does not authorize or dispatch a provider request. It binds one
-- reviewed PLACE candidate to the existing locked assessment, exact Guardian
-- scope set, reviewed Guardian state, and durable idempotency record that a
-- later source-only loader must re-read immediately before demo certification.

CREATE TABLE IF NOT EXISTS live_bitget_demo_place_control_bindings (
  binding_id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE,
  dispatch_attempt_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  operation TEXT NOT NULL DEFAULT 'PLACE' CHECK (operation = 'PLACE'),
  product_symbol TEXT NOT NULL,

  assessment_id TEXT NOT NULL UNIQUE,
  assessment_evidence_hash TEXT NOT NULL CHECK (length(assessment_evidence_hash) = 64),
  preview_hash TEXT NOT NULL CHECK (length(preview_hash) = 64),
  risk_decision_id TEXT NOT NULL,
  risk_configuration_version TEXT NOT NULL,
  risk_decision_hash TEXT NOT NULL CHECK (length(risk_decision_hash) = 64),

  guardian_scopes_json TEXT NOT NULL CHECK (
    json_valid(guardian_scopes_json)
    AND json_type(guardian_scopes_json) = 'array'
  ),
  guardian_scope_count INTEGER NOT NULL CHECK (
    guardian_scope_count BETWEEN 1 AND 8
    AND json_array_length(guardian_scopes_json) = guardian_scope_count
  ),
  guardian_scope_set_hash TEXT NOT NULL CHECK (length(guardian_scope_set_hash) = 64),
  guardian_reviewed_state_hash TEXT NOT NULL CHECK (length(guardian_reviewed_state_hash) = 64),

  idempotency_operation_id TEXT NOT NULL UNIQUE,
  idempotency_operation_scope TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),

  control_binding_hash TEXT NOT NULL UNIQUE CHECK (length(control_binding_hash) = 64),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO' CHECK (environment = 'BITGET_DEMO'),
  source_only INTEGER NOT NULL DEFAULT 1 CHECK (source_only = 1),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0),
  accounting_automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (accounting_automatically_dispatched = 0),
  bound_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (authorization_id)
    REFERENCES live_bitget_demo_dispatch_authorizations(authorization_id),
  FOREIGN KEY (assessment_id)
    REFERENCES live_candidate_assessments(assessment_id),
  FOREIGN KEY (idempotency_operation_id)
    REFERENCES idempotency_records(operation_id)
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_control_binding_account
  ON live_bitget_demo_place_control_bindings(exchange_account_id, product_symbol, bound_at);

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_place_control_bindings_no_update
BEFORE UPDATE ON live_bitget_demo_place_control_bindings
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_place_control_bindings cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_place_control_bindings_no_delete
BEFORE DELETE ON live_bitget_demo_place_control_bindings
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_place_control_bindings cannot be deleted');
END;
