-- Migration 029: immutable non-live operational rehearsal evidence.
--
-- A complete pack is evidence for independent review only. It does not deploy,
-- read credentials, send a demo request, mutate a provider, retry an ambiguous
-- result, dispatch accounting, or enable live/mainnet/real-funds capability.

CREATE TABLE IF NOT EXISTS live_bitget_demo_operational_rehearsal_packs (
  pack_id TEXT PRIMARY KEY,
  git_sha TEXT NOT NULL CHECK (length(git_sha) IN (40, 64)),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO_CERTIFICATION'
    CHECK (environment = 'BITGET_DEMO_CERTIFICATION'),
  scenarios_json TEXT NOT NULL CHECK (
    json_valid(scenarios_json)
    AND json_type(scenarios_json) = 'array'
  ),
  scenario_count INTEGER NOT NULL CHECK (
    scenario_count = 5
    AND json_array_length(scenarios_json) = scenario_count
  ),
  passed_count INTEGER NOT NULL CHECK (passed_count BETWEEN 0 AND scenario_count),
  blockers_json TEXT NOT NULL CHECK (
    json_valid(blockers_json)
    AND json_type(blockers_json) = 'array'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('BLOCKED', 'READY_FOR_INDEPENDENT_REVIEW')
  ),
  ready_for_independent_review INTEGER NOT NULL CHECK (
    ready_for_independent_review IN (0, 1)
  ),
  pack_hash TEXT NOT NULL UNIQUE CHECK (length(pack_hash) = 64),
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

  CHECK (
    (status = 'BLOCKED' AND ready_for_independent_review = 0)
    OR
    (status = 'READY_FOR_INDEPENDENT_REVIEW'
      AND ready_for_independent_review = 1
      AND passed_count = scenario_count)
  )
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_operational_rehearsal_time
  ON live_bitget_demo_operational_rehearsal_packs(prepared_at DESC);

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_operational_rehearsal_no_update
BEFORE UPDATE ON live_bitget_demo_operational_rehearsal_packs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo operational rehearsal packs cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_operational_rehearsal_no_delete
BEFORE DELETE ON live_bitget_demo_operational_rehearsal_packs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo operational rehearsal packs cannot be deleted');
END;
