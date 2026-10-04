-- Paper migration 003: distributed request-admission counters
--
-- Paper-Worker migrations use their own namespace so they cannot collide with
-- the isolated live-candidate migration sequence.
--
-- This table is intentionally separate from the legacy rate_limit_counters
-- table so the outer fail-closed boundary and the existing inner application
-- limiter do not double-count against the same bucket.

CREATE TABLE IF NOT EXISTS request_admission_counters (
  bucket     TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS request_admission_counters_expires_at_idx
  ON request_admission_counters (expires_at);
