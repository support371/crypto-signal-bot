-- Migration 008: hierarchical Guardian state and immutable events.

CREATE TABLE IF NOT EXISTS live_guardian_states (
  scope_type TEXT NOT NULL CHECK (scope_type IN (
    'GLOBAL', 'ENVIRONMENT', 'EXCHANGE', 'ACCOUNT', 'STRATEGY',
    'SYMBOL', 'ORDER_TYPE', 'WITHDRAWALS'
  )),
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CLEAR'
    CHECK (status IN ('CLEAR', 'RESTRICTED', 'HALTED')),
  reason_code TEXT,
  reason_detail TEXT,
  triggered_by TEXT,
  triggered_at TEXT,
  reset_requires_dual_approval INTEGER NOT NULL DEFAULT 1
    CHECK (reset_requires_dual_approval IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, scope_key),
  CHECK (
    (status = 'CLEAR' AND reason_code IS NULL AND triggered_at IS NULL)
    OR (status != 'CLEAR' AND reason_code IS NOT NULL AND triggered_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS live_guardian_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_detail TEXT,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_guardian_reset_requests (
  reset_request_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  expected_guardian_version INTEGER NOT NULL CHECK (expected_guardian_version >= 1),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  FOREIGN KEY (scope_type, scope_key)
    REFERENCES live_guardian_states(scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS live_guardian_reset_approvals (
  reset_request_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  approval_role TEXT NOT NULL CHECK (approval_role IN ('RISK_ADMIN', 'RELEASE_ADMIN')),
  approved_at TEXT NOT NULL,
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  PRIMARY KEY (reset_request_id, approver_id),
  FOREIGN KEY (reset_request_id) REFERENCES live_guardian_reset_requests(reset_request_id)
);

CREATE INDEX IF NOT EXISTS idx_live_guardian_states_status
  ON live_guardian_states(status, scope_type, scope_key);

CREATE INDEX IF NOT EXISTS idx_live_guardian_events_scope_sequence
  ON live_guardian_events(scope_type, scope_key, sequence_id);

CREATE INDEX IF NOT EXISTS idx_live_guardian_reset_status_expiry
  ON live_guardian_reset_requests(status, expires_at);

CREATE TRIGGER IF NOT EXISTS live_guardian_events_no_update
BEFORE UPDATE ON live_guardian_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_guardian_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_guardian_events_no_delete
BEFORE DELETE ON live_guardian_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_guardian_events cannot be deleted');
END;
