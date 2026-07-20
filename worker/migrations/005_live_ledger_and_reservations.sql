-- Migration 005: per-asset double-entry ledger and funds reservations.
-- No account is seeded and no financial mutation path is enabled.

CREATE TABLE IF NOT EXISTS ledger_accounts (
  ledger_account_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN (
    'CASH_AVAILABLE',
    'CASH_RESERVED',
    'INVENTORY_AVAILABLE',
    'INVENTORY_RESERVED',
    'EXCHANGE_CLEARING',
    'FEES_EXPENSE',
    'REALIZED_PNL',
    'DEPOSITS_CLEARING',
    'WITHDRAWALS_CLEARING',
    'RECONCILIATION_SUSPENSE'
  )),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exchange_account_id, asset, account_type)
);

CREATE TABLE IF NOT EXISTS ledger_journals (
  journal_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'POSTED'
    CHECK (status IN ('POSTED', 'REVERSED')),
  reversal_of_journal_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reversal_of_journal_id) REFERENCES ledger_journals(journal_id),
  UNIQUE (exchange_account_id, event_type, reference_type, reference_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  ledger_account_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount TEXT NOT NULL CHECK (
    amount GLOB '[0-9]*'
    AND amount NOT GLOB '*[^0-9.]*'
    AND amount != '0'
    AND amount != '0.0'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (journal_id) REFERENCES ledger_journals(journal_id),
  FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(ledger_account_id)
);

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL CHECK (
    amount GLOB '[0-9]*'
    AND amount NOT GLOB '*[^0-9.]*'
    AND amount != '0'
    AND amount != '0.0'
  ),
  consumed_amount TEXT NOT NULL DEFAULT '0' CHECK (
    consumed_amount GLOB '[0-9]*'
    AND consumed_amount NOT GLOB '*[^0-9.]*'
  ),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE (exchange_account_id, order_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_exchange_asset
  ON ledger_accounts(exchange_account_id, asset, account_type);

CREATE INDEX IF NOT EXISTS idx_ledger_journals_reference
  ON ledger_journals(exchange_account_id, reference_type, reference_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal
  ON ledger_entries(journal_id, asset, direction);

CREATE INDEX IF NOT EXISTS idx_reservations_account_status
  ON reservations(exchange_account_id, status, updated_at);

CREATE TRIGGER IF NOT EXISTS ledger_accounts_updated_at
AFTER UPDATE ON ledger_accounts
FOR EACH ROW
BEGIN
  UPDATE ledger_accounts
     SET updated_at = CURRENT_TIMESTAMP
   WHERE ledger_account_id = OLD.ledger_account_id;
END;

CREATE TRIGGER IF NOT EXISTS reservations_updated_at
AFTER UPDATE ON reservations
FOR EACH ROW
BEGIN
  UPDATE reservations
     SET updated_at = CURRENT_TIMESTAMP
   WHERE reservation_id = OLD.reservation_id;
END;
