PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_ingestions (
  binding_id TEXT PRIMARY KEY,
  attestation_id TEXT NOT NULL,
  certification_run_id TEXT NOT NULL,
  run_evidence_hash TEXT NOT NULL CHECK (length(run_evidence_hash) = 64),
  attestation_hash TEXT NOT NULL CHECK (length(attestation_hash) = 64),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('INJECTED_FIXTURES', 'ISOLATED_READ_ONLY_CLIENT')),
  certification_environment TEXT NOT NULL CHECK (certification_environment IN ('LOCAL_TEST', 'SHADOW', 'TESTNET', 'LIVE_CANDIDATE')),
  external_read_only_evidence INTEGER NOT NULL CHECK (external_read_only_evidence IN (0, 1)),
  ingestion_id TEXT NOT NULL UNIQUE,
  snapshot_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  ingestion_hash TEXT NOT NULL CHECK (length(ingestion_hash) = 64),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  accounting_task_count INTEGER NOT NULL CHECK (accounting_task_count >= 0),
  linked_at TEXT NOT NULL,
  binding_hash TEXT NOT NULL UNIQUE CHECK (length(binding_hash) = 64),
  automatic_accounting_dispatch_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_accounting_dispatch_allowed = 0),
  reservation_settlement_allowed INTEGER NOT NULL DEFAULT 0 CHECK (reservation_settlement_allowed = 0),
  certification_check_projection_allowed INTEGER NOT NULL DEFAULT 0 CHECK (certification_check_projection_allowed = 0),
  certified_for_live INTEGER NOT NULL DEFAULT 0 CHECK (certified_for_live = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0),
  transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK (transfer_allowed = 0),
  withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0),
  reconciliation_required INTEGER NOT NULL DEFAULT 1 CHECK (reconciliation_required = 1),
  incident_evidence_required INTEGER NOT NULL DEFAULT 1 CHECK (incident_evidence_required = 1),
  UNIQUE (attestation_id, ingestion_id),
  CHECK (
    (source_mode = 'INJECTED_FIXTURES' AND certification_environment = 'LOCAL_TEST' AND external_read_only_evidence = 0)
    OR
    (source_mode = 'ISOLATED_READ_ONLY_CLIENT' AND certification_environment IN ('SHADOW', 'TESTNET', 'LIVE_CANDIDATE') AND external_read_only_evidence = 1)
  )
);

CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_ingestion_events (
  binding_event_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL,
  attestation_id TEXT NOT NULL,
  ingestion_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'ATTESTED_RECOVERY_BOUND'),
  binding_hash TEXT NOT NULL CHECK (length(binding_hash) = 64),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_attested_recovery_attestation
  ON live_bitget_attested_recovery_ingestions (attestation_id);

CREATE INDEX IF NOT EXISTS idx_live_bitget_attested_recovery_account_product
  ON live_bitget_attested_recovery_ingestions (exchange_account_id, product_id, linked_at);

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_ingestions_no_update
BEFORE UPDATE ON live_bitget_attested_recovery_ingestions
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_ingestions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_ingestions_no_delete
BEFORE DELETE ON live_bitget_attested_recovery_ingestions
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_ingestions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_events_no_update
BEFORE UPDATE ON live_bitget_attested_recovery_ingestion_events
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_ingestion_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_attested_recovery_events_no_delete
BEFORE DELETE ON live_bitget_attested_recovery_ingestion_events
BEGIN
  SELECT RAISE(ABORT, 'live_bitget_attested_recovery_ingestion_events is append-only');
END;
