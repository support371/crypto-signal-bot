-- Migration 007: isolated read models for exchange accounts, products, orders,
-- fills, balances, positions, and order events.
-- Tables are prefixed with live_ to avoid legacy paper-table collisions.

CREATE TABLE IF NOT EXISTS live_exchange_accounts (
  exchange_account_id TEXT PRIMARY KEY,
  exchange_name TEXT NOT NULL,
  external_account_ref_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN ('DISCONNECTED', 'READ_ONLY', 'READY', 'RESTRICTED', 'HALTED', 'CLOSED')),
  eligible INTEGER NOT NULL DEFAULT 0 CHECK (eligible IN (0, 1)),
  reconciliation_clear INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_clear IN (0, 1)),
  last_reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_name, external_account_ref_hash)
);

CREATE TABLE IF NOT EXISTS live_products (
  exchange_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  status TEXT NOT NULL,
  trading_enabled INTEGER NOT NULL CHECK (trading_enabled IN (0, 1)),
  cancel_only INTEGER NOT NULL DEFAULT 0 CHECK (cancel_only IN (0, 1)),
  limit_only INTEGER NOT NULL DEFAULT 0 CHECK (limit_only IN (0, 1)),
  post_only INTEGER NOT NULL DEFAULT 0 CHECK (post_only IN (0, 1)),
  price TEXT,
  product_rules_json TEXT NOT NULL,
  raw_response_hash TEXT NOT NULL CHECK (length(raw_response_hash) = 64),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exchange_name, product_id),
  CHECK (expires_at > observed_at)
);

CREATE TABLE IF NOT EXISTS live_orders (
  internal_order_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  exchange_order_id TEXT,
  client_order_id TEXT,
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT')),
  state TEXT NOT NULL CHECK (state IN (
    'REQUESTED', 'VALIDATING', 'VALIDATED', 'RISK_REJECTED', 'RISK_APPROVED',
    'RESERVING', 'RESERVED', 'PREVIEWING', 'PREVIEW_REJECTED', 'SUBMITTING',
    'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED',
    'CANCEL_PENDING', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED',
    'RECOVERY_REQUIRED', 'SETTLED'
  )),
  requested_base_quantity TEXT,
  requested_quote_notional TEXT,
  filled_base_quantity TEXT NOT NULL DEFAULT '0',
  filled_quote_value TEXT,
  remaining_base_quantity TEXT,
  average_fill_price TEXT,
  total_fees TEXT,
  fee_asset TEXT,
  pending_cancel INTEGER NOT NULL DEFAULT 0 CHECK (pending_cancel IN (0, 1)),
  settled INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0, 1)),
  risk_decision_id TEXT,
  release_id TEXT,
  configuration_version TEXT NOT NULL,
  raw_status TEXT,
  raw_response_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  UNIQUE (exchange_account_id, client_order_id),
  UNIQUE (exchange_account_id, exchange_order_id),
  CHECK (
    (requested_base_quantity IS NOT NULL AND requested_quote_notional IS NULL)
    OR (requested_base_quantity IS NULL AND requested_quote_notional IS NOT NULL)
    OR (
      state = 'RECOVERY_REQUIRED'
      AND requested_base_quantity IS NULL
      AND requested_quote_notional IS NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS live_order_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  internal_order_id TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN (
    'api', 'exchange-rest', 'exchange-websocket', 'reconciliation', 'operator', 'system'
  )),
  source_event_id TEXT,
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  release_id TEXT,
  configuration_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (internal_order_id) REFERENCES live_orders(internal_order_id),
  UNIQUE (source, source_event_id)
);

CREATE TABLE IF NOT EXISTS live_fills (
  fill_id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  exchange_account_id TEXT NOT NULL,
  internal_order_id TEXT NOT NULL,
  exchange_order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price TEXT NOT NULL,
  base_size TEXT NOT NULL,
  quote_value TEXT NOT NULL,
  commission TEXT NOT NULL DEFAULT '0',
  commission_asset TEXT,
  trade_time TEXT NOT NULL,
  sequence_timestamp TEXT NOT NULL,
  raw_response_hash TEXT NOT NULL CHECK (length(raw_response_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  FOREIGN KEY (internal_order_id) REFERENCES live_orders(internal_order_id),
  UNIQUE (exchange_account_id, trade_id)
);

CREATE TABLE IF NOT EXISTS live_balance_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  external_asset_account_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  available TEXT NOT NULL,
  held TEXT NOT NULL,
  total TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  ready INTEGER NOT NULL CHECK (ready IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('exchange-rest', 'exchange-websocket', 'reconciliation')),
  raw_response_hash TEXT NOT NULL CHECK (length(raw_response_hash) = 64),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  UNIQUE (exchange_account_id, asset, observed_at)
);

CREATE TABLE IF NOT EXISTS live_positions (
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  quantity TEXT NOT NULL,
  available_quantity TEXT NOT NULL,
  reserved_quantity TEXT NOT NULL,
  average_entry_price TEXT,
  current_price TEXT,
  market_value TEXT,
  realized_pnl TEXT NOT NULL DEFAULT '0',
  unrealized_pnl TEXT NOT NULL DEFAULT '0',
  ledger_quantity TEXT NOT NULL,
  exchange_quantity TEXT NOT NULL,
  drift_quantity TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED', 'DRIFTED', 'RESTRICTED')),
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exchange_account_id, product_id),
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id)
);

CREATE INDEX IF NOT EXISTS idx_live_orders_account_state
  ON live_orders(exchange_account_id, state, updated_at);

CREATE INDEX IF NOT EXISTS idx_live_order_events_order_sequence
  ON live_order_events(internal_order_id, sequence_id);

CREATE INDEX IF NOT EXISTS idx_live_fills_order_time
  ON live_fills(internal_order_id, trade_time);

CREATE INDEX IF NOT EXISTS idx_live_balance_snapshots_account_time
  ON live_balance_snapshots(exchange_account_id, observed_at);

CREATE TRIGGER IF NOT EXISTS live_exchange_accounts_updated_at
AFTER UPDATE ON live_exchange_accounts
FOR EACH ROW
BEGIN
  UPDATE live_exchange_accounts
     SET updated_at = CURRENT_TIMESTAMP
   WHERE exchange_account_id = OLD.exchange_account_id;
END;
