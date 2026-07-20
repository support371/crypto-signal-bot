-- Migration 022: immutable source attestations for Bitget read-only certification evidence.
-- Attestation never projects automatically into release certification.

CREATE TABLE IF NOT EXISTS live_bitget_read_only_certification_attestations (
  attestation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_evidence_hash TEXT NOT NULL CHECK (length(run_evidence_hash) = 64),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('INJECTED_FIXTURES', 'ISOLATED_READ_ONLY_CLIENT')),
  environment TEXT NOT NULL CHECK (environment IN ('LOCAL_TEST', 'SHADOW', 'TESTNET', 'LIVE_CANDIDATE')),
  source_ref TEXT NOT NULL,
  operator_actor_id TEXT,
  authorization_event_hash TEXT,
  attested_at TEXT NOT NULL,
  attestation_hash TEXT NOT NULL UNIQUE CHECK (length(attestation_hash) = 64),
  external_read_only_evidence INTEGER NOT NULL CHECK (external_read_only_evidence IN (0, 1)),
  certification_check_projection_allowed INTEGER NOT NULL DEFAULT 0 CHECK (certification_check_projection_allowed = 0),
  certified_for_live INTEGER NOT NULL DEFAULT 0 CHECK (certified_for_live = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0),
  transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK (transfer_allowed = 0),
  withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES live_bitget_read_only_certification_runs(run_id),
  CHECK (
    (source_mode = 'INJECTED_FIXTURES'
      AND environment = 'LOCAL_TEST'
      AND operator_actor_id IS NULL
      AND authorization_event_hash IS NULL
      AND external_read_only_evidence = 0)
    OR
    (source_mode = 'ISOLATED_READ_ONLY_CLIENT'
      AND environment IN ('SHADOW', 'TESTNET', 'LIVE_CANDIDATE')
      AND operator_actor_id IS NOT NULL
      AND length(operator_actor_id) > 0
      AND authorization_event_hash IS NOT NULL
      AND length(authorization_event_hash) = 64
      AND external_read_only_evidence = 1)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_bitget_read_cert_attestation_run_mode
  ON live_bitget_read_only_certification_attestations(run_id, source_mode);

CREATE INDEX IF NOT EXISTS idx_live_bitget_read_cert_attestation_time
  ON live_bitget_read_only_certification_attestations(attested_at DESC);

CREATE TRIGGER IF NOT EXISTS live_bitget_read_only_certification_attestations_no_update
BEFORE UPDATE ON live_bitget_read_only_certification_attestations
BEGIN
  SELECT RAISE(ABORT, 'Bitget read-only certification attestations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_read_only_certification_attestations_no_delete
BEFORE DELETE ON live_bitget_read_only_certification_attestations
BEGIN
  SELECT RAISE(ABORT, 'Bitget read-only certification attestations cannot be deleted');
END;
