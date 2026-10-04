# Durable dispatch admission integrity

The source-only admission store binds one named account coordinator to its
account hash and exchange. Each accepted attempt atomically persists its
attempt/order/idempotency identity, an immutable budget receipt, and the exact
daily exposure cache. PLACE includes the conservative fee-inclusive notional;
CANCEL adds zero. Uncertain attempts continue to consume the allowance.

`getDailyExposure(evaluatedAt)` supplies release policy with the coordinator's
current UTC-day exposure. It checks account ownership, matching claim/receipt
counts, and the latest receipt's exact arithmetic against the cache. Missing,
decreased or inconsistent cache state fails closed before another claim. A new
day starts at zero without deleting prior attempts or permitting their replay.

SQL guards reject UPDATE, DELETE and conflicting INSERT OR REPLACE for account
ownership, attempts and budget receipts, including SQLite configurations with
recursive triggers disabled. A budget receipt must reference an existing
same-day attempt. All three writes roll back together on persistence failure.

Older claims without corresponding receipts block that day's admission. The
constructor does not silently reconstruct an allowance from incomplete state.
Any repair needs a separately reviewed reconciliation; deleting the budget cache
cannot authorize an additional send.

This primitive does not establish execution authority and is not deployed into
the paper or projection-only coordinator. Current release, roles, step-up,
Guardian, risk, reservations and external provider certification must still be
reloaded inside the serialized executable account operation before admission.
No credentials, provider transport, mainnet route or retry are added.

Acceptance uses real SQLite: restart/replay, concurrent limits, exact fractional
notionals, UTC rollover, cache loss/corruption, immutable replacement, orphan
receipts and transaction rollback. Passing these checks is local engineering
evidence, not external certification or mainnet activation.
