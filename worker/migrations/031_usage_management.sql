-- Migration 031: production user lifecycle, usage aggregation, immutable management
-- audit evidence, session-security evidence, and management-plane rate windows.
-- This migration adds no live execution capability and does not alter financial locks.

CREATE TABLE IF NOT EXISTS app_user_profiles (
  actor_id TEXT PRIMARY KEY,
  auth_provider_id TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED','PENDING','ACTIVE','SUSPENDED','DISABLED')),
  account_type TEXT NOT NULL DEFAULT 'STANDARD',
  onboarding_state TEXT NOT NULL DEFAULT 'COMPLETE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  suspended_at TEXT,
  suspended_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_user_profiles_status_updated
  ON app_user_profiles(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_app_user_profiles_email
  ON app_user_profiles(email);

CREATE TABLE IF NOT EXISTS live_actor_roles (
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'VIEWER','TRADER','RISK_OPERATOR','RISK_ADMIN',
    'WITHDRAWAL_REQUESTER','WITHDRAWAL_APPROVER','AUDITOR','RELEASE_ADMIN'
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

CREATE INDEX IF NOT EXISTS idx_live_actor_roles_actor_scope
  ON live_actor_roles(actor_id, scope_type, scope_key, expires_at, revoked_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_release_admin_bootstrap
  ON live_actor_roles(granted_by)
  WHERE granted_by = 'SYSTEM_BOOTSTRAP' AND role = 'RELEASE_ADMIN';

CREATE TABLE IF NOT EXISTS management_audit_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
  reason TEXT,
  request_id TEXT NOT NULL,
  previous_state_json TEXT,
  new_state_json TEXT,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_management_audit_actor_time
  ON management_audit_events(actor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_management_audit_resource_time
  ON management_audit_events(resource_type, resource_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS management_audit_events_no_update
BEFORE UPDATE ON management_audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'management_audit_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS management_audit_events_no_delete
BEFORE DELETE ON management_audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'management_audit_events cannot be deleted');
END;

CREATE TABLE IF NOT EXISTS app_usage_daily (
  day TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  category TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, actor_id, category)
);

CREATE INDEX IF NOT EXISTS idx_app_usage_daily_day_category
  ON app_usage_daily(day, category);

CREATE TABLE IF NOT EXISTS management_rate_windows (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS session_security_events (
  event_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_security_actor_time
  ON session_security_events(actor_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS session_security_events_no_update
BEFORE UPDATE ON session_security_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'session_security_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS session_security_events_no_delete
BEFORE DELETE ON session_security_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'session_security_events cannot be deleted');
END;
