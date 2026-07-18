PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_readiness (
  checkpoint_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL,
  binding_hash TEXT NOT NULL CHECK (length(binding_hash) = 64),
  attestation_id TEXT NOT NULL,
  ingestion_id TEXT NOT NULL,
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('INJECTED_FIXTURES', 'ISOLATED_READ_ONLY_CLIENT')),
  external_read_only_evidence INTEGER NOT NULL CHECK (external_read_only_evidence IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING_ACCOUNTING_REVIEW',
    'PENDING_SETTLEMENT',
    'PENDING_RECONCILIATION',
    'CLEAR',
    'HALT_FOR_REVIEW'
  )),
  reasons_json TEXT NOT NULL,
  accounting_task_count INTEGER NOT NULL CHECK (accounting_task_count >= 0),
  accounting_receipt_count INTEGER NOT NULL CHECK (
    accounting_receipt_count >= 0 AND accounting_receipt_count <= accounting_task_count
  ),
  reservation_required_count INTEGER NOT NULL CHECK (
    reservation_required_count >= 0 AND reservation_required_count <= accounting_task_count
  ),
  settlement_receipt_count INTEGER NOT NULL CHECK (
    settlement_receipt_count >= 0 AND settlement_receipt_count <= reservation_required_count
  ),
  dispatch_status TEXT NOT NULL CHECK (dispatch_status IN ('NOT_STARTED', 'COMPLETED', 'PARTIAL', 'FAILED')),
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('NOT_RUN', 'CLEAR', 'HALT_FOR_REVIEW')),
  latest_accounted_at TEXT,
  latest_settled_at TEXT,
  latest_reconciled_at TEXT,
  oldest_task_at TEXT,
  evaluated_at TEXT NOT NULL,
  checkpoint_hash TEXT NOT NULL UNIQUE CHECK (length(checkpoint_hash) = 64),
  incident_required INTEGER NOT NULL CHECK (incident_required IN (0, 1)),
  operator_review_required INTEGER NOT NULL CHECK (operator_review_required IN (0, 1)),
  automatic_accounting_dispatch_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_accounting_dispatch_allowed = 0),
  automatic_reservation_settlement_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_reservation_settlement_allowed = 0),
  automatic_reconciliation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_reconciliation_allowed = 0),
  certification_check_projection_allowed INTEGER NOT NULL DEFAULT 0 CHECK (certification_check_projection_allowed = 0),
  certified_for_live INTEGER NOT NULL DEFAULT 0 CHECK (certified_for_live = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0),
  transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK (transfer_allowed = 0),
  withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (binding_id, evaluated_at),
  FOREIGN KEY (binding_id) REFERENCES live_bitget_attested_recovery_ingestions(binding_id)
);

CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_readiness_events (
  checkpoint_event_id TEXT PRIMARY KEY,
  checkpoint_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'ATTESTED_RECOVERY_READINESS_EVALUATED'),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING_ACCOUNTING_REVIEW',
    'PENDING_SETTLEMENT',
    'PENDING_RECONCILIATION',
    'CLEAR',
    'HALT_FOR_REVIEW'
  )),
  checkpoint_hash TEXT NOT NULL CHECK (length(checkpoint_hash) = 64),
  incident_required INTEGER NOT NULL CHECK (incident_required IN (0, 1)),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (checkpoint_id) REFERENCES live_bitget_attested_recovery_readiness(checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_attested_recovery_readiness_binding_time
  ON live_bitget_attested_recovery_readiness (binding_id, evaluated_at);

CREATE INDEX IF NOT EXISTS idx_attested_recovery_readiness_status_time
  ON live_bitget_attested_recovery_readiness (status, incident_required, evaluated_at);

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_readiness_no_update
BEFORE UPDATE ON live_bitget_attested_recovery_readiness
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_readiness is append-only');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_readiness_no_delete
BEFORE DELETE ON live_bitget_attested_recovery_readiness
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_readiness is append-only');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_readiness_events_no_update
BEFORE UPDATE ON live_bitget_attested_recovery_readiness_events
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_readiness_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_readiness_events_no_delete
BEFORE DELETE ON live_bitget_attested_recovery_readiness_events
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_readiness_events is append-only');
END;
