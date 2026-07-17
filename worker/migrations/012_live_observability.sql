-- Migration 012: operational metrics, alerts, and immutable alert events.

CREATE TABLE IF NOT EXISTS live_metric_samples (
  metric_sample_id TEXT PRIMARY KEY,
  exchange_account_id TEXT,
  metric_name TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  metric_unit TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_alerts (
  alert_id TEXT PRIMARY KEY,
  exchange_account_id TEXT,
  alert_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),
  reason_code TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_account_id, alert_key)
);

CREATE TABLE IF NOT EXISTS live_alert_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_event_id TEXT NOT NULL UNIQUE,
  alert_id TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  actor_id TEXT,
  reason_code TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  correlation_id TEXT NOT NULL,
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES live_alerts(alert_id)
);

CREATE INDEX IF NOT EXISTS idx_live_metrics_name_time
  ON live_metric_samples(metric_name, observed_at);

CREATE INDEX IF NOT EXISTS idx_live_metrics_account_time
  ON live_metric_samples(exchange_account_id, observed_at);

CREATE INDEX IF NOT EXISTS idx_live_alerts_status_severity
  ON live_alerts(status, severity, last_observed_at);

CREATE INDEX IF NOT EXISTS idx_live_alert_events_alert_sequence
  ON live_alert_events(alert_id, sequence_id);

CREATE TRIGGER IF NOT EXISTS live_alert_events_no_update
BEFORE UPDATE ON live_alert_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_alert_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_alert_events_no_delete
BEFORE DELETE ON live_alert_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_alert_events cannot be deleted');
END;
