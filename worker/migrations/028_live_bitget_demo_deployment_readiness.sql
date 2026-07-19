-- Migration 028: immutable Bitget demo non-live deployment-readiness manifests.
--
-- A complete manifest permits independent deployment review only. It does not
-- deploy a Worker, read credentials, invoke a provider, or enable any execution
-- capability.

CREATE TABLE IF NOT EXISTS live_bitget_demo_deployment_readiness_manifests (
  manifest_id TEXT PRIMARY KEY,
  git_sha TEXT NOT NULL CHECK (length(git_sha) IN (40, 64)),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO_CERTIFICATION'
    CHECK (environment = 'BITGET_DEMO_CERTIFICATION'),
  external_attestation_id TEXT,
  external_attestation_hash TEXT CHECK (
    external_attestation_hash IS NULL OR length(external_attestation_hash) = 64
  ),
  evidence_hashes_json TEXT NOT NULL CHECK (
    json_valid(evidence_hashes_json)
    AND json_type(evidence_hashes_json) = 'object'
  ),
  checks_json TEXT NOT NULL CHECK (
    json_valid(checks_json)
    AND json_type(checks_json) = 'array'
  ),
  check_count INTEGER NOT NULL CHECK (
    check_count = 14
    AND json_array_length(checks_json) = check_count
  ),
  passed_count INTEGER NOT NULL CHECK (passed_count BETWEEN 0 AND check_count),
  blockers_json TEXT NOT NULL CHECK (
    json_valid(blockers_json)
    AND json_type(blockers_json) = 'array'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('BLOCKED', 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW')
  ),
  ready_for_non_live_deployment_review INTEGER NOT NULL CHECK (
    ready_for_non_live_deployment_review IN (0, 1)
  ),
  manifest_hash TEXT NOT NULL UNIQUE CHECK (length(manifest_hash) = 64),
  prepared_by TEXT NOT NULL,
  prepared_at TEXT NOT NULL,

  deployment_allowed INTEGER NOT NULL DEFAULT 0 CHECK (deployment_allowed = 0),
  demo_request_allowed INTEGER NOT NULL DEFAULT 0 CHECK (demo_request_allowed = 0),
  credentials_read INTEGER NOT NULL DEFAULT 0 CHECK (credentials_read = 0),
  credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0),
  accounting_automatically_dispatched INTEGER NOT NULL DEFAULT 0
    CHECK (accounting_automatically_dispatched = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (external_attestation_id)
    REFERENCES live_bitget_read_only_certification_attestations(attestation_id),
  CHECK (
    (status = 'BLOCKED' AND ready_for_non_live_deployment_review = 0)
    OR
    (status = 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
      AND ready_for_non_live_deployment_review = 1
      AND passed_count = check_count
      AND external_attestation_id IS NOT NULL
      AND external_attestation_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_deployment_readiness_time
  ON live_bitget_demo_deployment_readiness_manifests(prepared_at DESC);

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_deployment_readiness_no_update
BEFORE UPDATE ON live_bitget_demo_deployment_readiness_manifests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo deployment-readiness manifests cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_deployment_readiness_no_delete
BEFORE DELETE ON live_bitget_demo_deployment_readiness_manifests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo deployment-readiness manifests cannot be deleted');
END;
