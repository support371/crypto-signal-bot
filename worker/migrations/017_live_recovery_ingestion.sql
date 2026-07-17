-- Migration 017: immutable provider recovery snapshots and accounting task intents.
-- This schema records recovered read-only evidence. It does not call an
-- exchange, apply accounting, settle reservations, or authorize execution.

CREATE TABLE IF NOT EXISTS live_recovery_ingestions (
  ingestion_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('BITGET', 'BTCC')),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL UNIQUE,
  snapshot_hash TEXT NOT NULL UNIQUE CHECK (length(snapshot_hash) = 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  ingestion_hash TEXT NOT NULL UNIQUE CHECK (length(ingestion_hash) = 64),
  window_start_ms INTEGER NOT NULL CHECK (window_start_ms >= 0),
  window_end_ms INTEGER NOT NULL CHECK (window_end_ms > window_start_ms),
  server_timestamp_ms INTEGER NOT NULL CHECK (server_timestamp_ms >= 0),
  order_count INTEGER NOT NULL CHECK (order_count >= 0),
  fill_count INTEGER NOT NULL CHECK (fill_count >= 0),
  accounting_task_count INTEGER NOT NULL CHECK (accounting_task_count = fill_count),
  complete INTEGER NOT NULL DEFAULT 1 CHECK (complete = 1),
  bounded INTEGER NOT NULL DEFAULT 1 CHECK (bounded = 1),
  read_only INTEGER NOT NULL DEFAULT 1 CHECK (read_only = 1),
  accounting_applied INTEGER NOT NULL DEFAULT 0 CHECK (accounting_applied = 0),
  reservation_settled INTEGER NOT NULL DEFAULT 0 CHECK (reservation_settled = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  recovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_recovery_order_observations (
  observation_id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('BITGET', 'BTCC')),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  order_identity TEXT NOT NULL,
  order_hash TEXT NOT NULL CHECK (length(order_hash) = 64),
  order_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingestion_id) REFERENCES live_recovery_ingestions(ingestion_id),
  UNIQUE (ingestion_id, order_identity, observed_at)
);

CREATE TABLE IF NOT EXISTS live_recovery_fill_observations (
  observation_id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('BITGET', 'BTCC')),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  fill_id TEXT NOT NULL,
  fill_hash TEXT NOT NULL CHECK (length(fill_hash) = 64),
  fill_json TEXT NOT NULL,
  sequence_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingestion_id) REFERENCES live_recovery_ingestions(ingestion_id),
  UNIQUE (provider, exchange_account_id, fill_id)
);

CREATE TABLE IF NOT EXISTS live_recovery_accounting_task_intents (
  task_intent_id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('BITGET', 'BTCC')),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  fill_id TEXT NOT NULL,
  fill_hash TEXT NOT NULL CHECK (length(fill_hash) = 64),
  sequence_timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_ACCOUNTING'
    CHECK (status = 'PENDING_ACCOUNTING'),
  accounting_applied INTEGER NOT NULL DEFAULT 0 CHECK (accounting_applied = 0),
  reservation_settled INTEGER NOT NULL DEFAULT 0 CHECK (reservation_settled = 0),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingestion_id) REFERENCES live_recovery_ingestions(ingestion_id),
  UNIQUE (provider, exchange_account_id, fill_id)
);

CREATE TABLE IF NOT EXISTS live_recovery_ingestion_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_event_id TEXT NOT NULL UNIQUE,
  ingestion_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('BITGET', 'BTCC')),
  event_type TEXT NOT NULL CHECK (event_type = 'RECOVERY_INGESTED'),
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  ingestion_hash TEXT NOT NULL CHECK (length(ingestion_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingestion_id) REFERENCES live_recovery_ingestions(ingestion_id)
);

CREATE INDEX IF NOT EXISTS idx_live_recovery_ingestions_account_time
  ON live_recovery_ingestions(provider, exchange_account_id, recovered_at);

CREATE INDEX IF NOT EXISTS idx_live_recovery_orders_account_time
  ON live_recovery_order_observations(provider, exchange_account_id, observed_at);

CREATE INDEX IF NOT EXISTS idx_live_recovery_fills_account_time
  ON live_recovery_fill_observations(provider, exchange_account_id, sequence_timestamp);

CREATE INDEX IF NOT EXISTS idx_live_recovery_tasks_account_time
  ON live_recovery_accounting_task_intents(
    provider, exchange_account_id, status, sequence_timestamp
  );

CREATE TRIGGER IF NOT EXISTS live_recovery_ingestions_no_update
BEFORE UPDATE ON live_recovery_ingestions
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_ingestions cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_ingestions_no_delete
BEFORE DELETE ON live_recovery_ingestions
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_ingestions cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_order_observations_no_update
BEFORE UPDATE ON live_recovery_order_observations
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_order_observations cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_order_observations_no_delete
BEFORE DELETE ON live_recovery_order_observations
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_order_observations cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_fill_observations_no_update
BEFORE UPDATE ON live_recovery_fill_observations
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_fill_observations cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_fill_observations_no_delete
BEFORE DELETE ON live_recovery_fill_observations
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_fill_observations cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_task_intents_no_update
BEFORE UPDATE ON live_recovery_accounting_task_intents
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_task_intents cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_accounting_task_intents_no_delete
BEFORE DELETE ON live_recovery_accounting_task_intents
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_accounting_task_intents cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_ingestion_events_no_update
BEFORE UPDATE ON live_recovery_ingestion_events
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_ingestion_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_recovery_ingestion_events_no_delete
BEFORE DELETE ON live_recovery_ingestion_events
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_recovery_ingestion_events cannot be deleted');
END;
