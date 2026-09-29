-- 032: paper order idempotency.
-- placePaperOrder() deduplicates retried /intent/paper intents on this key.
-- SQLite UNIQUE indexes treat NULLs as distinct, so rows without a key
-- (including all pre-existing rows) never conflict.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders (idempotency_key);
