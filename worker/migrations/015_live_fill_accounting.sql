-- Migration 015: append-only fill accounting, FIFO cost-basis lots, and P&L.
-- This schema records accounting evidence only. It does not submit exchange
-- requests, apply reservations, or authorize execution.

CREATE TABLE IF NOT EXISTS live_fill_accounting_receipts (
  accounting_receipt_id TEXT PRIMARY KEY,
  fill_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  internal_order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method = 'FIFO'),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  accounting_hash TEXT NOT NULL UNIQUE CHECK (length(accounting_hash) = 64),
  journal_id TEXT NOT NULL UNIQUE,
  position_quantity TEXT NOT NULL,
  cumulative_realized_pnl_quote TEXT NOT NULL,
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  accounted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fill_id) REFERENCES live_fills(fill_id),
  FOREIGN KEY (journal_id) REFERENCES ledger_journals(journal_id)
);

CREATE TABLE IF NOT EXISTS live_cost_basis_lots (
  lot_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  acquired_fill_id TEXT NOT NULL UNIQUE,
  acquired_at TEXT NOT NULL,
  original_quantity TEXT NOT NULL,
  original_cost_quote TEXT NOT NULL,
  unit_cost_quote TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method = 'FIFO'),
  accounting_hash TEXT NOT NULL CHECK (length(accounting_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (acquired_fill_id) REFERENCES live_fills(fill_id)
);

CREATE TABLE IF NOT EXISTS live_cost_basis_consumptions (
  consumption_id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  disposal_fill_id TEXT NOT NULL,
  quantity TEXT NOT NULL,
  cost_basis_quote TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method = 'FIFO'),
  accounting_hash TEXT NOT NULL CHECK (length(accounting_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lot_id) REFERENCES live_cost_basis_lots(lot_id),
  FOREIGN KEY (disposal_fill_id) REFERENCES live_fills(fill_id),
  UNIQUE (disposal_fill_id, lot_id)
);

CREATE TABLE IF NOT EXISTS live_realized_pnl_events (
  realized_pnl_event_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  internal_order_id TEXT NOT NULL,
  fill_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  disposed_quantity TEXT NOT NULL,
  gross_proceeds_quote TEXT NOT NULL,
  fee_quote_value TEXT NOT NULL,
  net_proceeds_quote TEXT NOT NULL,
  cost_basis_quote TEXT NOT NULL,
  realized_pnl_quote TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method = 'FIFO'),
  realized_at TEXT NOT NULL,
  accounting_hash TEXT NOT NULL CHECK (length(accounting_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fill_id) REFERENCES live_fills(fill_id)
);

CREATE TABLE IF NOT EXISTS live_position_accounting (
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  quantity TEXT NOT NULL,
  total_cost_basis_quote TEXT NOT NULL,
  average_entry_price TEXT,
  cumulative_realized_pnl_quote TEXT NOT NULL DEFAULT '0',
  current_price TEXT,
  market_value_quote TEXT,
  unrealized_pnl_quote TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  last_accounting_hash TEXT NOT NULL CHECK (length(last_accounting_hash) = 64),
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exchange_account_id, product_id)
);

CREATE TABLE IF NOT EXISTS live_fill_accounting_reconciliations (
  reconciliation_id TEXT PRIMARY KEY,
  exchange_name TEXT NOT NULL CHECK (exchange_name IN ('BTCC', 'BITGET')),
  exchange_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CLEAR', 'HALT_FOR_REVIEW')),
  reasons_json TEXT NOT NULL,
  position_quantity TEXT NOT NULL,
  reconstructed_quantity TEXT NOT NULL,
  position_cost_basis_quote TEXT NOT NULL,
  reconstructed_cost_basis_quote TEXT NOT NULL,
  position_realized_pnl_quote TEXT NOT NULL,
  reconstructed_realized_pnl_quote TEXT NOT NULL,
  ledger_base_inventory_balance TEXT NOT NULL,
  exchange_base_balance TEXT,
  current_price TEXT,
  market_value_quote TEXT,
  unrealized_pnl_quote TEXT,
  reconciliation_hash TEXT NOT NULL UNIQUE CHECK (length(reconciliation_hash) = 64),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  reservation_applied INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_applied = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_account_id, product_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_live_cost_basis_lots_account_product_time
  ON live_cost_basis_lots(exchange_account_id, product_id, acquired_at, lot_id);

CREATE INDEX IF NOT EXISTS idx_live_cost_basis_consumptions_lot_time
  ON live_cost_basis_consumptions(lot_id, consumed_at);

CREATE INDEX IF NOT EXISTS idx_live_realized_pnl_account_product_time
  ON live_realized_pnl_events(exchange_account_id, product_id, realized_at);

CREATE INDEX IF NOT EXISTS idx_live_fill_accounting_reconciliation_status_time
  ON live_fill_accounting_reconciliations(status, observed_at);

CREATE TRIGGER IF NOT EXISTS live_fill_accounting_receipts_no_update
BEFORE UPDATE ON live_fill_accounting_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_fill_accounting_receipts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_fill_accounting_receipts_no_delete
BEFORE DELETE ON live_fill_accounting_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_fill_accounting_receipts cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_cost_basis_lots_no_update
BEFORE UPDATE ON live_cost_basis_lots
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_cost_basis_lots cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_cost_basis_lots_no_delete
BEFORE DELETE ON live_cost_basis_lots
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_cost_basis_lots cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_cost_basis_consumptions_no_update
BEFORE UPDATE ON live_cost_basis_consumptions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_cost_basis_consumptions cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_cost_basis_consumptions_no_delete
BEFORE DELETE ON live_cost_basis_consumptions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_cost_basis_consumptions cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_realized_pnl_events_no_update
BEFORE UPDATE ON live_realized_pnl_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_realized_pnl_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_realized_pnl_events_no_delete
BEFORE DELETE ON live_realized_pnl_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_realized_pnl_events cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_fill_accounting_reconciliations_no_update
BEFORE UPDATE ON live_fill_accounting_reconciliations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_fill_accounting_reconciliations cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_fill_accounting_reconciliations_no_delete
BEFORE DELETE ON live_fill_accounting_reconciliations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_fill_accounting_reconciliations cannot be deleted');
END;
