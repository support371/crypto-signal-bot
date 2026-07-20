-- Migration 025: immutable, independently reviewed Bitget demo-dispatch
-- attempts and results. These tables are evidence only. They cannot authorize
-- live/mainnet execution, real-funds movement, withdrawals, or automatic retry.

CREATE TABLE IF NOT EXISTS live_bitget_demo_dispatch_authorizations (
  authorization_id TEXT PRIMARY KEY,
  dispatch_attempt_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  operation TEXT NOT NULL CHECK (operation IN ('PLACE', 'CANCEL', 'CANCEL_REPLACE')),
  endpoint TEXT NOT NULL CHECK (endpoint IN (
    '/api/v2/spot/trade/place-order',
    '/api/v2/spot/trade/cancel-order',
    '/api/v2/spot/trade/cancel-replace-order'
  )),
  product_symbol TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  preparer_id TEXT NOT NULL,
  authorization_evidence_hash TEXT NOT NULL CHECK (length(authorization_evidence_hash) = 64),
  step_up_evidence_hash TEXT NOT NULL CHECK (length(step_up_evidence_hash) = 64),
  risk_evidence_hash TEXT NOT NULL CHECK (length(risk_evidence_hash) = 64),
  guardian_evidence_hash TEXT NOT NULL CHECK (length(guardian_evidence_hash) = 64),
  idempotency_evidence_hash TEXT NOT NULL CHECK (length(idempotency_evidence_hash) = 64),
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > valid_from),
  validity_seconds INTEGER NOT NULL CHECK (validity_seconds >= 1 AND validity_seconds <= 300),
  authorization_hash TEXT NOT NULL UNIQUE CHECK (length(authorization_hash) = 64),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO' CHECK (environment = 'BITGET_DEMO'),
  account_coordinator_serialized INTEGER NOT NULL DEFAULT 1
    CHECK (account_coordinator_serialized = 1),
  guardian_clear INTEGER NOT NULL DEFAULT 1 CHECK (guardian_clear = 1),
  risk_approved INTEGER NOT NULL DEFAULT 1 CHECK (risk_approved = 1),
  idempotency_claimed INTEGER NOT NULL DEFAULT 1 CHECK (idempotency_claimed = 1),
  demo_mutation_reviewed INTEGER NOT NULL DEFAULT 1 CHECK (demo_mutation_reviewed = 1),
  live_release_present INTEGER NOT NULL DEFAULT 0 CHECK (live_release_present = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0 CHECK (automatically_retried = 0),
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (authorization_id) REFERENCES live_authorization_events(authorization_event_id),
  CHECK (actor_id <> preparer_id),
  CHECK (
    (operation = 'PLACE' AND endpoint = '/api/v2/spot/trade/place-order')
    OR (operation = 'CANCEL' AND endpoint = '/api/v2/spot/trade/cancel-order')
    OR (
      operation = 'CANCEL_REPLACE'
      AND endpoint = '/api/v2/spot/trade/cancel-replace-order'
    )
  )
);

CREATE TABLE IF NOT EXISTS live_bitget_demo_dispatch_claims (
  dispatch_attempt_id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  authorization_hash TEXT NOT NULL CHECK (length(authorization_hash) = 64),
  claim_hash TEXT NOT NULL UNIQUE CHECK (length(claim_hash) = 64),
  one_shot INTEGER NOT NULL DEFAULT 1 CHECK (one_shot = 1),
  requires_account_coordinator_serialization INTEGER NOT NULL DEFAULT 1
    CHECK (requires_account_coordinator_serialization = 1),
  demo_dispatch_reviewed INTEGER NOT NULL DEFAULT 1
    CHECK (demo_dispatch_reviewed = 1),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0 CHECK (automatically_retried = 0),
  claimed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (authorization_id)
    REFERENCES live_bitget_demo_dispatch_authorizations(authorization_id),
  FOREIGN KEY (dispatch_attempt_id)
    REFERENCES live_bitget_demo_dispatch_authorizations(dispatch_attempt_id)
);

CREATE TABLE IF NOT EXISTS live_bitget_demo_dispatch_results (
  dispatch_attempt_id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE,
  exchange_account_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL UNIQUE CHECK (length(candidate_hash) = 64),
  operation TEXT NOT NULL CHECK (operation IN ('PLACE', 'CANCEL', 'CANCEL_REPLACE')),
  endpoint TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'ACKNOWLEDGED',
    'CANCEL_REPLACE_REQUIRES_LOOKUP',
    'AMBIGUOUS_REQUIRES_LOOKUP',
    'IDENTITY_MISMATCH_REQUIRES_REVIEW',
    'AUTHORIZATION_FAILED',
    'RATE_LIMITED',
    'TERMINAL_REJECTED',
    'UNKNOWN_REQUIRES_REVIEW',
    'PRE_SEND_BLOCKED'
  )),
  reason TEXT NOT NULL,
  request_body_hash TEXT CHECK (request_body_hash IS NULL OR length(request_body_hash) = 64),
  rate_limit_receipt_hash TEXT
    CHECK (rate_limit_receipt_hash IS NULL OR length(rate_limit_receipt_hash) = 64),
  http_status INTEGER CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
  provider_code TEXT,
  provider_message TEXT,
  acknowledged_order_id TEXT,
  acknowledged_client_order_id TEXT,
  recovery_lookup_count INTEGER NOT NULL CHECK (recovery_lookup_count >= 0 AND recovery_lookup_count <= 2),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  result_hash TEXT NOT NULL UNIQUE CHECK (length(result_hash) = 64),
  environment TEXT NOT NULL DEFAULT 'BITGET_DEMO' CHECK (environment = 'BITGET_DEMO'),
  demo_request_sent INTEGER NOT NULL CHECK (demo_request_sent IN (0, 1)),
  demo_provider_mutation_attempted INTEGER NOT NULL
    CHECK (demo_provider_mutation_attempted IN (0, 1)),
  requires_read_only_recovery INTEGER NOT NULL CHECK (requires_read_only_recovery IN (0, 1)),
  provider_acknowledgment_verified INTEGER NOT NULL
    CHECK (provider_acknowledgment_verified IN (0, 1)),
  real_provider_mutation_allowed INTEGER NOT NULL DEFAULT 0
    CHECK (real_provider_mutation_allowed = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  real_funds_allowed INTEGER NOT NULL DEFAULT 0 CHECK (real_funds_allowed = 0),
  mainnet_allowed INTEGER NOT NULL DEFAULT 0 CHECK (mainnet_allowed = 0),
  withdrawals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (withdrawals_allowed = 0),
  automatically_retried INTEGER NOT NULL DEFAULT 0 CHECK (automatically_retried = 0),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dispatch_attempt_id)
    REFERENCES live_bitget_demo_dispatch_claims(dispatch_attempt_id),
  FOREIGN KEY (authorization_id)
    REFERENCES live_bitget_demo_dispatch_authorizations(authorization_id),
  CHECK (demo_provider_mutation_attempted = demo_request_sent),
  CHECK (recovery_lookup_count = 0 OR requires_read_only_recovery = 1),
  CHECK (provider_acknowledgment_verified = 0 OR category = 'ACKNOWLEDGED'),
  CHECK (
    (operation = 'PLACE' AND endpoint = '/api/v2/spot/trade/place-order')
    OR (operation = 'CANCEL' AND endpoint = '/api/v2/spot/trade/cancel-order')
    OR (
      operation = 'CANCEL_REPLACE'
      AND endpoint = '/api/v2/spot/trade/cancel-replace-order'
    )
  )
);

CREATE TABLE IF NOT EXISTS live_bitget_demo_dispatch_recovery_requirements (
  dispatch_attempt_id TEXT NOT NULL,
  lookup_index INTEGER NOT NULL CHECK (lookup_index >= 0 AND lookup_index <= 1),
  method TEXT NOT NULL DEFAULT 'GET' CHECK (method = 'GET'),
  endpoint TEXT NOT NULL DEFAULT '/api/v2/spot/trade/orderInfo'
    CHECK (endpoint = '/api/v2/spot/trade/orderInfo'),
  product_symbol TEXT NOT NULL,
  order_id TEXT,
  client_order_id TEXT,
  lookup_hash TEXT NOT NULL UNIQUE CHECK (length(lookup_hash) = 64),
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0),
  live_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_allowed = 0),
  automatically_dispatched INTEGER NOT NULL DEFAULT 0 CHECK (automatically_dispatched = 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dispatch_attempt_id, lookup_index),
  FOREIGN KEY (dispatch_attempt_id)
    REFERENCES live_bitget_demo_dispatch_results(dispatch_attempt_id),
  CHECK ((order_id IS NULL) <> (client_order_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_authorizations_account_time
  ON live_bitget_demo_dispatch_authorizations(exchange_account_id, reviewed_at);

CREATE INDEX IF NOT EXISTS idx_live_bitget_demo_results_account_time
  ON live_bitget_demo_dispatch_results(exchange_account_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_claim_requires_exact_authorization
BEFORE INSERT ON live_bitget_demo_dispatch_claims
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM live_bitget_demo_dispatch_authorizations authorization
   WHERE authorization.authorization_id = NEW.authorization_id
     AND authorization.dispatch_attempt_id = NEW.dispatch_attempt_id
     AND authorization.exchange_account_id = NEW.exchange_account_id
     AND authorization.candidate_hash = NEW.candidate_hash
     AND authorization.authorization_hash = NEW.authorization_hash
)
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo claim does not match immutable authorization');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_result_requires_exact_claim
BEFORE INSERT ON live_bitget_demo_dispatch_results
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM live_bitget_demo_dispatch_claims claim
   WHERE claim.dispatch_attempt_id = NEW.dispatch_attempt_id
     AND claim.authorization_id = NEW.authorization_id
     AND claim.exchange_account_id = NEW.exchange_account_id
     AND claim.candidate_hash = NEW.candidate_hash
     AND EXISTS (
       SELECT 1
         FROM live_bitget_demo_dispatch_authorizations authorization
        WHERE authorization.authorization_id = NEW.authorization_id
          AND authorization.dispatch_attempt_id = NEW.dispatch_attempt_id
          AND authorization.operation = NEW.operation
          AND authorization.endpoint = NEW.endpoint
     )
)
BEGIN
  SELECT RAISE(ABORT, 'Bitget demo result does not match immutable one-shot claim');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_authorizations_no_update
BEFORE UPDATE ON live_bitget_demo_dispatch_authorizations
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_authorizations cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_authorizations_no_delete
BEFORE DELETE ON live_bitget_demo_dispatch_authorizations
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_authorizations cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_claims_no_update
BEFORE UPDATE ON live_bitget_demo_dispatch_claims
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_claims cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_claims_no_delete
BEFORE DELETE ON live_bitget_demo_dispatch_claims
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_claims cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_results_no_update
BEFORE UPDATE ON live_bitget_demo_dispatch_results
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_results cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_results_no_delete
BEFORE DELETE ON live_bitget_demo_dispatch_results
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_results cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_requirements_no_update
BEFORE UPDATE ON live_bitget_demo_dispatch_recovery_requirements
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_recovery_requirements cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS live_bitget_demo_recovery_requirements_no_delete
BEFORE DELETE ON live_bitget_demo_dispatch_recovery_requirements
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'live_bitget_demo_dispatch_recovery_requirements cannot be deleted');
END;
