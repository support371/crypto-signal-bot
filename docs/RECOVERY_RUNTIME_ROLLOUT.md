# Recovery runtime rollout

The canonical Worker now places the recovered atomic request-admission boundary
before all application routes. The five-minute cron composes existing recovery
discovery, lookup planning and D1 queue registration. This is discovery of
persisted orders, not permission to submit or retry them.

## Deployment ordering

1. Complete the exact-commit validation and release gates.
2. Apply `worker/migrations/paper/003_request_admission_counters.sql` to the
   canonical paper D1 database. `npm --prefix worker run deploy` applies this
   additive migration before deploying; CircleCI and the manual self-hosted
   release use that command.
3. Deploy the accepted Worker artifact with the correct account credentials.
4. Check ordinary requests, quota rejection and unavailable-storage rejection.
   Without the admission schema, every request deliberately fails with 503.

## Scheduled discovery prerequisites

Before setting `LIVE_RECOVERY_DISCOVERY_ENABLED=true`, the canonical database
must have the existing live account/order/outbox schemas (migrations 007 and
009), the appropriate remaining live migrations, and independently verified
account records. `LIVE_RECOVERY_ACCOUNT_IDS` is a JSON list of 1–25 unique
account IDs. There is no unscoped fallback. Only explicitly mapped Bitget
accounts in READ_ONLY, READY, RESTRICTED or HALTED state are accepted.

Each invocation queues at most 100 persisted observations. Unchanged queued
observations are excluded so later orders and accounts can progress. Concurrent
cron delivery uses the existing unique queue event ID and immutable envelope
hash. A change to persisted order identity/state creates distinct evidence.
Missing identities create manual-review work. BTCC accounts cannot be routed
through this Bitget discovery boundary.

No native Cloudflare Queue is required for this stage: migration 009 already
provides durable queue registration, atomic claim, completion/failure and dead
letter contracts. The existing account coordinator provides serialized
assessment and accounting boundaries.

## Remaining stages

Discovery is runtime-wired, but its downstream consumer is not complete. A
verified account-specific read credential mapping, provider GET lookup,
attestation, serialized state projection, reviewed fill accounting, reservation
settlement and replayable dashboard events are still required. Existing
`BitgetReadOnlyRecoveryClient`, `runAttestedBitgetRecoveryCycle`, recovery
accounting approval/dispatch and `ExchangeAccountCoordinator` must be composed
for these stages. Do not replace them with another execution or ledger system.

The new flags remain disabled because this environment cannot verify or
configure these database/account prerequisites. This does not designate paper
mode as the final target. A future production activation release must satisfy
all authorization, Guardian, risk, provider, infrastructure and release gates.
Withdrawals require their independent release gate.
