-- Migration 002: Hardened Worker tables
-- Adds circuit_breaker_state, rate_limit_counters, system_config
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT)

CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  source       TEXT PRIMARY KEY,
  open         INTEGER NOT NULL DEFAULT 0,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  last_fail_at DATETIME
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket TEXT PRIMARY KEY,
  count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed known circuit breaker entries (closed by default)
INSERT OR IGNORE INTO circuit_breaker_state (source, open, fail_count) VALUES ('coinbase', 0, 0);
INSERT OR IGNORE INTO circuit_breaker_state (source, open, fail_count) VALUES ('binance', 0, 0);

-- Ensure guardian_state row exists
INSERT OR IGNORE INTO guardian_state (id, triggered, reason, error_count, drawdown_pct)
  VALUES (1, 0, NULL, 0, 0.0);

-- Ensure USDT balance row exists
INSERT OR IGNORE INTO portfolio (symbol, side, quantity, entry_price, current_price, pnl, status)
  VALUES ('USDT', 'balance', 10000, 1.0, 1.0, 0, 'balance');

-- Add detail column to orders if it doesn't exist (for idempotency key storage)
-- SQLite ALTER TABLE ADD COLUMN is safe if column doesn't exist
-- We use a no-op approach: the column is optional and used by idempotency checks
