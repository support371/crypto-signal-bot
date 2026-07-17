-- Migration 010: role assignments, short-lived step-up sessions, and
-- immutable authorization decisions. Identity verification remains external.

CREATE TABLE IF NOT EXISTS live_actor_roles (
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'VIEWER',
    'TRADER',
    'RISK_OPERATOR',
    'RISK_ADMIN',
    'WITHDRAWAL_REQUESTER',
    'WITHDRAWAL_APPROVER',
    'AUDITOR',
    'RELEASE_ADMIN'
  )),
  scope_type TEXT NOT NULL DEFAULT 'GLOBAL'
    CHECK (scope_type IN ('GLOBAL', 'EXCHANGE', 'ACCOUNT')),
  scope_key TEXT NOT NULL DEFAULT 'global',
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (actor_id, role, scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS live_step_up_sessions (
  step_up_session_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  authentication_method TEXT NOT NULL,
  assurance_level TEXT NOT NULL CHECK (assurance_level IN ('AAL2', 'AAL3')),
  audience TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  session_hash TEXT NOT NULL UNIQUE CHECK (length(session_hash) = 64),
  CHECK (expires_at > issued_at)
);

CREATE TABLE IF NOT EXISTS live_authorization_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  authorization_event_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  required_roles_json TEXT NOT NULL,
  actor_roles_json TEXT NOT NULL,
  step_up_required INTEGER NOT NULL CHECK (step_up_required IN (0, 1)),
  step_up_session_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
  reason TEXT,
  correlation_id TEXT NOT NULL,
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (step_up_session_id) REFERENCES live_step_up_sessions(step_up_session_id)
);

CREATE INDEX IF NOT EXISTS idx_live_actor_roles_actor_scope
  ON live_actor_roles(actor_id, scope_type, scope_key, expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS idx_live_step_up_actor_expiry
  ON live_step_up_sessions(actor_id, expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS idx_live_authorization_actor_time
  ON live_authorization_events(actor_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS live_authorization_events_no_update
BEFORE UPDATE ON live_authorization_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_authorization_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_authorization_events_no_delete
BEFORE DELETE ON live_authorization_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_authorization_events cannot be deleted');
END;
