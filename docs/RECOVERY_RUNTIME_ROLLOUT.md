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

## GET-only recovery consumption

The canonical five-minute schedule awaits discovery before consuming reads.
`LIVE_RECOVERY_READ_ENABLED=true` requires an explicit single
`LIVE_RECOVERY_READ_ACCOUNT_ID`, `LIVE_RECOVERY_READ_ATTESTATIONS` mapping
product IDs to existing immutable attestation IDs, and the existing
`BITGET_CERT_API_KEY`, `BITGET_CERT_API_SECRET`, `BITGET_CERT_API_PASSPHRASE`
Secrets Store bindings. Do not put credentials in vars, source or browser code.
The account's `external_account_ref_hash` must equal `canonicalHash` of the
Bitget account-info user ID. This credential group is deliberately scoped to
one account; it does not infer a multi-account credential mapping.

Each pass claims at most five discovery records using the existing queue
contract. It verifies the queued payload hash/identity against current persisted
order evidence, requires all eight certification checks and a matching external
attestation no older than 24 hours, verifies actual GET credential permissions
and provider account identity, then composes `BitgetReadOnlyRecoveryClient` and
`runAttestedBitgetRecoveryCycle`. Collection response handling is shared with
the existing certification parser; missing/full pages remain fail-closed.
Base-sized orders require exact quantity, product, both known provider IDs,
side and order type. Quote-sized/unknown-sized orders, missing IDs, changed
observations, unavailable history windows and unsupported providers require
review. No BTCC order is routed to Bitget.

The stage persists immutable observations, pending accounting intents, the
existing attested binding/audit event and a `NOTIFY_ALERT` outbox record with
the reconciliation decision. It does not apply order-state, fill, balance,
position, ledger or reservation projections. Those require the existing
reviewed approval and serialized coordinator stages. A queue COMPLETED status
means observation ingestion completed, not financial reconciliation completed.

Only GET observation leases older than two minutes are reclaimable. Completion
and failure require the current claim timestamp so an expired Worker cannot
acknowledge a successor lease. Read failures retry at most three times, then
remain FAILED with `RECOVERY_READ_REVIEW_REQUIRED` for operator review.
Provider error text and credential values are never stored in queue errors.
The reused transport body boundary now bounds reads as well as demo writes,
including stalled fetches/bodies that ignore abort signals and oversized streams.
Stable account/snapshot/attestation identifiers and observation timestamps make
a crash between persistence and queue acknowledgement replayable.

## Remaining stages

The integrated source now connects reviewed FIFO dispatch, explicit per-fill
reservation settlement, zero/partial cancellation release, order completion and
authenticated replayable dashboard events. See REVIEWED_OPERATIONS_INTEGRATION.md
and PRODUCTION_COMPLETION_ACCEPTANCE.md for verification and deployment status.
Existing recovery accounting approval/dispatch and
`ExchangeAccountCoordinator` must remain the authority for those stages.
Do not replace them with another execution or ledger system.

The new flags remain disabled because this environment cannot verify or
configure these database/account prerequisites. This does not designate paper
mode as the final target. A future production activation release must satisfy
all authorization, Guardian, risk, provider, infrastructure and release gates.
Withdrawals require their independent release gate.
