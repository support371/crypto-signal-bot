-- Migration 011: deposit observation and dual-approved withdrawal lifecycle.
-- No destination plaintext, private key, provider credential, or active transfer
-- capability is stored by this schema.

CREATE TABLE IF NOT EXISTS live_transfer_destinations (
  destination_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  destination_ref_hash TEXT NOT NULL CHECK (length(destination_ref_hash) = 64),
  memo_ref_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  screening_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (screening_status IN ('PENDING', 'CLEAR', 'BLOCKED', 'EXPIRED', 'REVIEW_REQUIRED')),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  activates_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  UNIQUE (exchange_account_id, asset, network, destination_ref_hash, memo_ref_hash)
);

CREATE TABLE IF NOT EXISTS live_deposits (
  deposit_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT,
  quantity TEXT NOT NULL,
  destination_ref_hash TEXT,
  memo_ref_hash TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'DETECTED', 'PENDING', 'CONFIRMING', 'COMPLETED', 'FAILED',
    'REVERSED', 'RECOVERY_REQUIRED'
  )),
  confirmation_count INTEGER,
  required_confirmations INTEGER,
  detected_at TEXT NOT NULL,
  completed_at TEXT,
  raw_response_hash TEXT NOT NULL CHECK (length(raw_response_hash) = 64),
  ledger_journal_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  UNIQUE (exchange_account_id, provider_transaction_id)
);

CREATE TABLE IF NOT EXISTS live_withdrawals (
  withdrawal_id TEXT PRIMARY KEY,
  exchange_account_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  amount TEXT NOT NULL,
  estimated_fee TEXT,
  actual_fee TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED', 'SCREENING', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED',
    'TIME_LOCKED', 'PREVIEWING', 'SUBMITTING', 'SUBMITTED', 'CONFIRMING',
    'COMPLETED', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED'
  )),
  idempotency_key TEXT NOT NULL,
  provider_withdrawal_id TEXT,
  provider_transaction_id TEXT,
  release_at TEXT,
  requested_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  ledger_journal_id TEXT,
  configuration_version TEXT NOT NULL,
  release_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exchange_account_id) REFERENCES live_exchange_accounts(exchange_account_id),
  FOREIGN KEY (destination_id) REFERENCES live_transfer_destinations(destination_id),
  UNIQUE (exchange_account_id, idempotency_key),
  UNIQUE (exchange_account_id, provider_withdrawal_id)
);

CREATE TABLE IF NOT EXISTS live_withdrawal_approvals (
  withdrawal_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  approval_role TEXT NOT NULL CHECK (approval_role IN ('WITHDRAWAL_APPROVER', 'RISK_ADMIN')),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  reason TEXT,
  step_up_session_id TEXT NOT NULL,
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  decided_at TEXT NOT NULL,
  PRIMARY KEY (withdrawal_id, approver_id),
  FOREIGN KEY (withdrawal_id) REFERENCES live_withdrawals(withdrawal_id),
  FOREIGN KEY (step_up_session_id) REFERENCES live_step_up_sessions(step_up_session_id)
);

CREATE TABLE IF NOT EXISTS live_transfer_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  transfer_type TEXT NOT NULL CHECK (transfer_type IN ('DEPOSIT', 'WITHDRAWAL', 'DESTINATION')),
  transfer_id TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  actor_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('provider-rest', 'provider-webhook', 'reconciliation', 'operator', 'system')),
  source_event_id TEXT,
  correlation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  audit_event_hash TEXT NOT NULL CHECK (length(audit_event_hash) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_live_destinations_account_status
  ON live_transfer_destinations(exchange_account_id, status, screening_status, activates_at);

CREATE INDEX IF NOT EXISTS idx_live_deposits_account_status
  ON live_deposits(exchange_account_id, status, detected_at);

CREATE INDEX IF NOT EXISTS idx_live_withdrawals_account_status
  ON live_withdrawals(exchange_account_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_live_transfer_events_transfer
  ON live_transfer_events(transfer_type, transfer_id, sequence_id);

CREATE TRIGGER IF NOT EXISTS live_transfer_events_no_update
BEFORE UPDATE ON live_transfer_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_transfer_events cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_transfer_events_no_delete
BEFORE DELETE ON live_transfer_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'live_transfer_events cannot be deleted');
END;
