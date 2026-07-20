-- Migration 030: immutable real-market certification signal and fill simulation evidence.
--
-- These records are generated from public Bitget candles, an execution-locked
-- local preview, deterministic risk evidence, and synthetic FIFO accounting.
-- They never represent a provider order or provider fill and cannot enable
-- provider mutation, real funds, mainnet, withdrawals, or automatic persistence.

CREATE TABLE IF NOT EXISTS live_certification_signal_evidence (
  signal_evidence_hash TEXT PRIMARY KEY CHECK (length(signal_evidence_hash) = 64),
  signal_identity_hash TEXT NOT NULL UNIQUE CHECK (length(signal_identity_hash) = 64),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  provider TEXT NOT NULL CHECK (provider = 'BITGET'),
  product_symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL', 'HOLD')),
  confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
  reference_price TEXT NOT NULL,
  latest_closed_at_ms INTEGER NOT NULL CHECK (latest_closed_at_ms > 0),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  requires_independent_risk_decision INTEGER NOT NULL DEFAULT 1
    CHECK (requires_independent_risk_decision = 1),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_certification_signal_assessments (
  assessment_binding_hash TEXT PRIMARY KEY CHECK (length(assessment_binding_hash) = 64),
  signal_evidence_hash TEXT NOT NULL REFERENCES live_certification_signal_evidence(signal_evidence_hash),
  candidate_assessment_hash TEXT NOT NULL CHECK (length(candidate_assessment_hash) = 64),
  exchange_account_id TEXT NOT NULL,
  internal_order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  status TEXT NOT NULL CHECK (status = 'READY_BUT_EXECUTION_LOCKED'),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  reservation_applied INTEGER NOT NULL DEFAULT 0 CHECK (reservation_applied = 0),
  automatically_submitted INTEGER NOT NULL DEFAULT 0 CHECK (automatically_submitted = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_certification_fill_simulations (
  simulation_hash TEXT PRIMARY KEY CHECK (length(simulation_hash) = 64),
  assessment_binding_hash TEXT NOT NULL UNIQUE
    REFERENCES live_certification_signal_assessments(assessment_binding_hash),
  signal_evidence_hash TEXT NOT NULL REFERENCES live_certification_signal_evidence(signal_evidence_hash),
  fill_id TEXT NOT NULL UNIQUE,
  accounting_hash TEXT NOT NULL CHECK (length(accounting_hash) = 64),
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  fill_price TEXT NOT NULL,
  base_size TEXT NOT NULL,
  commission TEXT NOT NULL,
  simulated_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  provider_order_created INTEGER NOT NULL DEFAULT 0 CHECK (provider_order_created = 0),
  provider_fill_claimed INTEGER NOT NULL DEFAULT 0 CHECK (provider_fill_claimed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0 CHECK (reservation_applied = 0),
  automatically_persisted INTEGER NOT NULL DEFAULT 0 CHECK (automatically_persisted = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  persisted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_certification_signals_product_time
  ON live_certification_signal_evidence(product_symbol, latest_closed_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_live_certification_simulations_product_time
  ON live_certification_fill_simulations(product_id, simulated_at DESC);

CREATE TRIGGER IF NOT EXISTS live_certification_signal_no_update
BEFORE UPDATE ON live_certification_signal_evidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'certification signal evidence cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS live_certification_signal_no_delete
BEFORE DELETE ON live_certification_signal_evidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'certification signal evidence cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS live_certification_assessment_no_update
BEFORE UPDATE ON live_certification_signal_assessments FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'certification signal assessments cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS live_certification_assessment_no_delete
BEFORE DELETE ON live_certification_signal_assessments FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'certification signal assessments cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS live_certification_fill_simulation_no_update
BEFORE UPDATE ON live_certification_fill_simulations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'certification fill simulations cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS live_certification_fill_simulation_no_delete
BEFORE DELETE ON live_certification_fill_simulations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'certification fill simulations cannot be deleted'); END;
