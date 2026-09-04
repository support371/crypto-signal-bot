CREATE TABLE IF NOT EXISTS switchere_funding_sessions (
  id TEXT PRIMARY KEY,
  partner_order_id TEXT NOT NULL UNIQUE,
  status_token_hash TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  client_reference TEXT NOT NULL,
  client_email_hash TEXT NOT NULL,
  client_country TEXT NOT NULL,
  payin_amount TEXT NOT NULL,
  payin_currency TEXT NOT NULL,
  payout_amount TEXT,
  payout_currency TEXT NOT NULL,
  dst_address_hash TEXT NOT NULL,
  provider_status TEXT NOT NULL DEFAULT 'preflight_passed',
  provider_substatus TEXT,
  provider_error TEXT,
  masked_card TEXT,
  bank_authorization_status TEXT NOT NULL DEFAULT 'pending',
  bank_second_factor_status TEXT NOT NULL DEFAULT 'provider_managed',
  card_verification_status TEXT NOT NULL DEFAULT 'pending',
  client_approved INTEGER NOT NULL CHECK (client_approved IN (0, 1)),
  live_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_switchere_funding_status_token
  ON switchere_funding_sessions(status_token_hash);

CREATE INDEX IF NOT EXISTS idx_switchere_funding_status
  ON switchere_funding_sessions(provider_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_switchere_funding_actor
  ON switchere_funding_sessions(actor_hash, created_at DESC);
