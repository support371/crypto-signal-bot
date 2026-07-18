-- Migration 021: immutable, non-live Bitget read-only contract certification.
-- Migration 020 remains reserved for recovery accounting dispatch-attempt claims.

CREATE TABLE IF NOT EXISTS live_bitget_read_only_certification_runs (
  run_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'BITGET'),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'BLOCKED')),
  read_only_evidence_complete INTEGER NOT NULL CHECK (read_only_evidence_complete IN (0, 1)),
  permissions_verified INTEGER NOT NULL CHECK (permissions_verified IN (0, 1)),
  product_count INTEGER NOT NULL CHECK (product_count >= 0),
  balance_count INTEGER NOT NULL CHECK (balance_count >= 0),
  current_order_count INTEGER NOT NULL CHECK (current_order_count >= 0),
  history_order_count INTEGER NOT NULL CHECK (history_order_count >= 0),
  fill_count INTEGER NOT NULL CHECK (fill_count >= 0),
  duplicate_order_count INTEGER NOT NULL CHECK (duplicate_order_count >= 0),
  duplicate_fill_count INTEGER NOT NULL CHECK (duplicate_fill_count >= 0),
  evaluated_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL UNIQUE CHECK (length(evidence_hash) = 64),
  certified_for_live INTEGER NOT NULL DEFAULT 0 CHECK (certified_for_live = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0),
  transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK (transfer_allowed = 0),
  withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_bitget_read_only_certification_checks (
  run_id TEXT NOT NULL,
  check_name TEXT NOT NULL CHECK (check_name IN (
    'READ_ONLY_PERMISSIONS',
    'PRODUCT_CONTRACT',
    'BALANCE_CONTRACT',
    'CURRENT_ORDER_CONTRACT',
    'ORDER_HISTORY_CONTRACT',
    'FILL_CONTRACT',
    'PAGINATION_BOUNDARY',
    'RECOVERY_IDENTITY_CONSISTENCY'
  )),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'BLOCKED')),
  reason TEXT,
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, check_name),
  FOREIGN KEY (run_id) REFERENCES live_bitget_read_only_certification_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_read_cert_account_time
  ON live_bitget_read_only_certification_runs(exchange_account_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_bitget_read_cert_product_time
  ON live_bitget_read_only_certification_runs(product_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_bitget_read_cert_status_time
  ON live_bitget_read_only_certification_runs(status, evaluated_at DESC);

CREATE TRIGGER IF NOT EXISTS live_bitget_read_only_certification_runs_no_update
BEFORE UPDATE ON live_bitget_read_only_certification_runs
BEGIN
  SELECT RAISE(ABORT, 'Bitget read-only certification runs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_read_only_certification_runs_no_delete
BEFORE DELETE ON live_bitget_read_only_certification_runs
BEGIN
  SELECT RAISE(ABORT, 'Bitget read-only certification runs cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_read_only_certification_checks_no_update
BEFORE UPDATE ON live_bitget_read_only_certification_checks
BEGIN
  SELECT RAISE(ABORT, 'Bitget read-only certification checks are immutable');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_read_only_certification_checks_no_delete
BEFORE DELETE ON live_bitget_read_only_certification_checks
BEGIN
  SELECT RAISE(ABORT, 'Bitget read-only certification checks cannot be deleted');
END;
