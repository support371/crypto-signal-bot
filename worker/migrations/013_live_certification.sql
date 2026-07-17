-- Migration 013: immutable certification runs and check evidence.
-- Certification records evidence only; they do not activate execution.

CREATE TABLE IF NOT EXISTS live_certification_runs (
  certification_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  git_sha TEXT NOT NULL CHECK (length(git_sha) = 40),
  worker_deployment_id TEXT NOT NULL,
  frontend_deployment_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  exchange_name TEXT NOT NULL,
  exchange_account_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('SHADOW', 'SANDBOX', 'TESTNET', 'LIVE_CANDIDATE')),
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'PASSED', 'FAILED', 'EXPIRED', 'REVOKED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  security_review_ref TEXT NOT NULL,
  compliance_review_ref TEXT NOT NULL,
  rollback_evidence_ref TEXT NOT NULL,
  disaster_recovery_evidence_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (release_id) REFERENCES release_authorizations(release_id),
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  CHECK (expires_at > started_at)
);

CREATE TABLE IF NOT EXISTS live_certification_checks (
  certification_id TEXT NOT NULL,
  check_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'BUILD', 'SECURITY', 'AUTHORIZATION', 'EXCHANGE', 'MARKET_DATA',
    'ORDER_LIFECYCLE', 'LEDGER', 'RECONCILIATION', 'GUARDIAN',
    'QUEUES', 'TRANSFERS', 'OBSERVABILITY', 'ROLLBACK', 'DISASTER_RECOVERY'
  )),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE')),
  evidence_ref TEXT,
  evidence_hash TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  evaluated_at TEXT,
  evaluator_id TEXT,
  PRIMARY KEY (certification_id, check_name),
  FOREIGN KEY (certification_id) REFERENCES live_certification_runs(certification_id),
  CHECK (evidence_hash IS NULL OR length(evidence_hash) = 64)
);

CREATE TABLE IF NOT EXISTS live_certification_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  certification_event_id TEXT NOT NULL UNIQUE,
  certification_id TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (certification_id) REFERENCES live_certification_runs(certification_id)
);

CREATE INDEX IF NOT EXISTS idx_live_certification_release_status
  ON live_certification_runs(release_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_live_certification_checks_status
  ON live_certification_checks(certification_id, mandatory, status, category);

CREATE INDEX IF NOT EXISTS idx_live_certification_events_sequence
  ON live_certification_events(certification_id, sequence_id);

CREATE TRIGGER IF NOT EXISTS live_certification_events_no_update
BEFORE UPDATE ON live_certification_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_certification_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_certification_events_no_delete
BEFORE DELETE ON live_certification_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_certification_events cannot be deleted');
END;
