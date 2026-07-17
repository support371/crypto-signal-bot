-- Migration 003: durable live release authorization records
-- This migration does not activate live trading and seeds no active authorization.

CREATE TABLE IF NOT EXISTS release_authorizations (
  release_id TEXT PRIMARY KEY,
  git_sha TEXT NOT NULL CHECK (length(git_sha) >= 40),
  worker_deployment_id TEXT NOT NULL,
  frontend_deployment_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  exchange_name TEXT NOT NULL,
  account_ref_hash TEXT NOT NULL,
  allowed_products_json TEXT NOT NULL DEFAULT '[]',
  max_order_notional TEXT NOT NULL CHECK (
    max_order_notional GLOB '[0-9]*' AND max_order_notional NOT GLOB '*[^0-9.]*'
  ),
  max_daily_notional TEXT NOT NULL CHECK (
    max_daily_notional GLOB '[0-9]*' AND max_daily_notional NOT GLOB '*[^0-9.]*'
  ),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  approved_by_json TEXT NOT NULL DEFAULT '[]',
  security_review_ref TEXT NOT NULL,
  compliance_review_ref TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_release_authorizations_status_expiry
  ON release_authorizations(status, expires_at);

CREATE TRIGGER IF NOT EXISTS release_authorizations_updated_at
AFTER UPDATE ON release_authorizations
FOR EACH ROW
BEGIN
  UPDATE release_authorizations
     SET updated_at = CURRENT_TIMESTAMP
   WHERE release_id = OLD.release_id;
END;
