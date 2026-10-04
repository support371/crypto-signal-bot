-- Internal projection release only. No provider mutation or execution authority.
CREATE TABLE IF NOT EXISTS live_zero_fill_reservation_releases (
  release_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations(reservation_id),
  exchange_account_id TEXT NOT NULL REFERENCES live_exchange_accounts(exchange_account_id),
  internal_order_id TEXT NOT NULL REFERENCES live_orders(internal_order_id),
  terminal_event_id TEXT NOT NULL REFERENCES live_order_events(event_id),
  authorization_event_id TEXT NOT NULL REFERENCES live_authorization_events(authorization_event_id),
  journal_id TEXT NOT NULL UNIQUE REFERENCES ledger_journals(journal_id),
  released_amount TEXT NOT NULL,
  previous_version INTEGER NOT NULL CHECK (previous_version >= 0),
  next_version INTEGER NOT NULL CHECK (next_version = previous_version + 1),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
  occurred_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS live_zero_fill_release_verify
BEFORE INSERT ON live_zero_fill_reservation_releases
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM reservations r JOIN live_orders o ON o.internal_order_id = r.order_id
    JOIN live_order_events e ON e.event_id = NEW.terminal_event_id
    JOIN ledger_journals j ON j.journal_id = NEW.journal_id
    WHERE r.reservation_id = NEW.reservation_id AND r.exchange_account_id = NEW.exchange_account_id
      AND r.order_id = NEW.internal_order_id AND r.status = 'RELEASED' AND r.consumed_amount = '0'
      AND r.amount = NEW.released_amount AND r.version = NEW.next_version
      AND o.exchange_account_id = NEW.exchange_account_id
      AND o.state IN ('CANCELLED','REJECTED','EXPIRED') AND o.pending_cancel = 0 AND o.settled = 0
      AND o.filled_base_quantity = '0' AND COALESCE(o.filled_quote_value,'0') = '0'
      AND e.internal_order_id = o.internal_order_id AND e.next_state = o.state
      AND e.source IN ('exchange-rest','exchange-websocket','reconciliation')
      AND e.sequence_id = (SELECT MAX(sequence_id) FROM live_order_events WHERE internal_order_id=o.internal_order_id)
      AND NOT EXISTS (SELECT 1 FROM live_fills WHERE internal_order_id=o.internal_order_id)
      AND j.exchange_account_id = NEW.exchange_account_id AND j.status = 'POSTED'
      AND j.event_type = 'FUNDS_RESERVATION_RELEASED' AND j.reference_type = 'ORDER'
      AND j.reference_id = NEW.internal_order_id
      AND (SELECT COUNT(*) FROM ledger_entries WHERE journal_id=NEW.journal_id) = 2
      AND EXISTS (SELECT 1 FROM ledger_entries d JOIN ledger_accounts da ON da.ledger_account_id=d.ledger_account_id
        JOIN ledger_entries c ON c.journal_id=d.journal_id AND c.direction='CREDIT'
        JOIN ledger_accounts ca ON ca.ledger_account_id=c.ledger_account_id
        WHERE d.journal_id=NEW.journal_id AND d.direction='DEBIT'
          AND d.amount=NEW.released_amount AND c.amount=NEW.released_amount
          AND d.asset=r.asset AND c.asset=r.asset AND da.asset=r.asset AND ca.asset=r.asset
          AND da.exchange_account_id=NEW.exchange_account_id AND ca.exchange_account_id=NEW.exchange_account_id
          AND da.status='ACTIVE' AND ca.status='ACTIVE'
          AND ((da.account_type='CASH_AVAILABLE' AND ca.account_type='CASH_RESERVED')
            OR (da.account_type='INVENTORY_AVAILABLE' AND ca.account_type='INVENTORY_RESERVED')))
      AND EXISTS (SELECT 1 FROM live_authorization_events au
        WHERE au.authorization_event_id=NEW.authorization_event_id AND au.resource_type='ORDER_COMPLETION'
          AND au.resource_id=NEW.internal_order_id AND au.action='RUN_RECONCILIATION'
          AND au.decision='ALLOW' AND au.step_up_required=1)
  ) THEN RAISE(ABORT,'zero-fill release evidence mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS live_zero_fill_releases_no_update
BEFORE UPDATE ON live_zero_fill_reservation_releases
BEGIN SELECT RAISE(ABORT,'zero-fill release receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_zero_fill_releases_no_delete
BEFORE DELETE ON live_zero_fill_reservation_releases
BEGIN SELECT RAISE(ABORT,'zero-fill release receipts are immutable'); END;
