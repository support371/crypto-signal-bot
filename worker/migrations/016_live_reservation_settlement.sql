-- Migration 016: exact reservation consumption and terminal remainder release.
-- This migration updates internal accounting state only. It does not call an
-- exchange, submit an order, transfer funds, or authorize execution.

ALTER TABLE reservations
  ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);

CREATE TABLE IF NOT EXISTS live_reservation_settlement_receipts (
  settlement_receipt_id TEXT PRIMARY KEY,
  fill_id TEXT NOT NULL UNIQUE,
  accounting_hash TEXT NOT NULL CHECK (length(accounting_hash) = 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  reservation_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  previous_version INTEGER NOT NULL CHECK (previous_version >= 0),
  next_version INTEGER NOT NULL CHECK (next_version = previous_version + 1),
  consumed_delta TEXT NOT NULL,
  previous_consumed_amount TEXT NOT NULL,
  next_consumed_amount TEXT NOT NULL,
  released_amount TEXT NOT NULL DEFAULT '0',
  previous_status TEXT NOT NULL
    CHECK (previous_status IN ('ACTIVE', 'PARTIALLY_CONSUMED')),
  next_status TEXT NOT NULL
    CHECK (next_status IN ('PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED')),
  release_journal_id TEXT,
  settlement_hash TEXT NOT NULL UNIQUE CHECK (length(settlement_hash) = 64),
  reservation_state_updated INTEGER NOT NULL DEFAULT 1
    CHECK (reservation_state_updated = 1),
  release_journal_posted INTEGER NOT NULL DEFAULT 0
    CHECK (release_journal_posted IN (0, 1)),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (execution_allowed = 0),
  settled_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fill_id) REFERENCES live_fills(fill_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),
  FOREIGN KEY (release_journal_id) REFERENCES ledger_journals(journal_id),
  CHECK (
    (next_status = 'RELEASED' AND release_journal_id IS NOT NULL AND release_journal_posted = 1)
    OR (next_status != 'RELEASED' AND release_journal_id IS NULL AND release_journal_posted = 0)
  )
);

CREATE TABLE IF NOT EXISTS live_reservation_settlement_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_event_id TEXT NOT NULL UNIQUE,
  settlement_receipt_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  fill_id TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  previous_version INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  consumed_delta TEXT NOT NULL,
  released_amount TEXT NOT NULL,
  settlement_hash TEXT NOT NULL CHECK (length(settlement_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (settlement_receipt_id)
    REFERENCES live_reservation_settlement_receipts(settlement_receipt_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),
  FOREIGN KEY (fill_id) REFERENCES live_fills(fill_id)
);

CREATE INDEX IF NOT EXISTS idx_live_reservation_settlement_reservation_time
  ON live_reservation_settlement_receipts(reservation_id, settled_at);

CREATE INDEX IF NOT EXISTS idx_live_reservation_settlement_events_receipt_sequence
  ON live_reservation_settlement_events(settlement_receipt_id, sequence_id);

CREATE TRIGGER IF NOT EXISTS live_reservation_settlement_verify_state
BEFORE INSERT ON live_reservation_settlement_receipts
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM reservations
     WHERE reservation_id = NEW.reservation_id
       AND asset = NEW.asset
       AND consumed_amount = NEW.next_consumed_amount
       AND status = NEW.next_status
       AND version = NEW.next_version
  ) THEN RAISE(ABORT, 'reservation settlement state verification failed') END;
END;

CREATE TRIGGER IF NOT EXISTS live_reservation_settlement_receipts_no_update
BEFORE UPDATE ON live_reservation_settlement_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_reservation_settlement_receipts cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_reservation_settlement_receipts_no_delete
BEFORE DELETE ON live_reservation_settlement_receipts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_reservation_settlement_receipts cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_reservation_settlement_events_no_update
BEFORE UPDATE ON live_reservation_settlement_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_reservation_settlement_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_reservation_settlement_events_no_delete
BEFORE DELETE ON live_reservation_settlement_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_reservation_settlement_events cannot be deleted');
END;
