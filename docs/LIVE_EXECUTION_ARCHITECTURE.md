# Live Execution Architecture — Disabled Candidate

## Status

This branch contains the disabled foundation of a future real-money-capable execution system. It does not enable live trading, deposits, or withdrawals.

The live-candidate Worker is read-only, has no public financial route or cron trigger, and always reports `liveReady: false`.

## Canonical exchange policy

The execution-provider order is fixed in code and configuration:

1. **BTCC** — primary execution target.
2. **Bitget** — secondary execution target and current default public market-data source.

`bitgate` is treated only as a legacy spelling of `Bitget`.

Coinbase is optional public/read-only data support. It is not a default execution exchange and cannot be certified as the execution provider for this candidate.

BTCC remains fail-closed until an official endpoint manifest is imported, hashed, reviewed, and restricted to verified read-only operations. No BTCC endpoint path or signing rule may be guessed from incomplete documentation.

Bitget currently has strict spot response normalizers, an authenticated read-only REST transport, and a local locked preview. The transport accepts only allowlisted `GET` requests, checks response and query limits, rejects redirects, and rejects API-key authorities that include trading, transfer, or withdrawal permissions.

## Safety invariants

- `NETWORK=testnet` by default.
- `ALLOW_MAINNET=false` by default.
- `LIVE_EXECUTION_ENABLED=false` by default.
- `WITHDRAWALS_ENABLED=false` by default.
- No exchange credential exists in source, TOML variables, D1, KV, R2, browser storage, tests, logs, or documentation.
- Candidate resources use isolated names and placeholder IDs.
- Legacy live, order, transfer, and withdrawal routes return HTTP 403.
- Every public non-safe HTTP method returns HTTP 403.
- Sensitive reads fail closed when operator authentication is absent.
- Public Worker routes cannot reach the account coordinator, candidate evidence endpoints, projection-alert acknowledgment, fill accounting, tax-lot, P&L, or reservation-settlement workflows.
- The account Durable Object remains halted for orders, cancellation, replacement, transfers, and withdrawals.
- Durable Object alarms retry D1 reporting projections and observability delivery only; they cannot submit, cancel, replace, transfer, or withdraw.
- Candidate assessment reservation drafts remain constrained to `applied=0`.
- Post-fill reservation settlement is a separate internal accounting transition bound to an immutable fill-accounting receipt; it cannot call an exchange or authorize execution.
- Projection-alert acknowledgment cannot retry a projection, apply a reservation, alter Guardian state, or unlock execution.
- No timeout, ambiguous response, alarm retry, alert acknowledgment, accounting replay, reservation settlement, or repeated request authorizes another order submission.
- Preview, assessment, persisted evidence, projection records, observability results, fill-accounting receipts, and settlement receipts permanently deny provider mutation and execution.
- Certification evidence can never activate the candidate; `certifiedForLive` is permanently false in this branch.

## Implemented layers

### Provider registry and contracts

`worker/src/live/exchange-registry.ts` enforces BTCC first and Bitget second. Coinbase is marked `marketDataOnly` and `executionDefault=false`.

`worker/src/live/adapters/btcc/contract.ts` requires a dated, SHA-256-bound, HTTPS, GET-only endpoint manifest before a BTCC read client can be implemented. Mutating-looking endpoint names or paths are rejected.

`worker/src/live/adapters/bitget/endpoints.ts` contains the verified read-only spot endpoint allowlist. `worker/src/live/adapters/bitget/read-only-client.ts` implements bounded HMAC-authenticated reads through an injected server-side secret provider. It does not implement order placement, cancellation, replacement, deposit, transfer, or withdrawal requests.

`worker/src/live/adapters/bitget/normalizer.ts` normalizes product rules, balances, orders, and fills using exact decimal strings. Market buys remain quote-sized; the adapter never invents a requested base quantity.

### Exact financial representation

`worker/src/live/decimal.ts` uses BigInt-backed decimal coefficients and explicit scale. It provides canonical parsing, comparison, addition, multiplication, exact downward-rounded division, signed and non-negative subtraction, increment alignment, and downward quantization.

JavaScript floating-point values are not used for order quantities, notionals, increments, ledger amounts, fees, previews, FIFO allocation, P&L, or reconciliation quantities.

### Product-rule enforcement

`worker/src/live/product-rules.ts` rejects stale or future-dated metadata, disabled products, unsupported order types, ambiguous size bases, increment mismatches, limit violations, and missing or prohibited price fields. It never silently rounds an invalid order into validity.

### Locked Bitget preview

`worker/src/live/adapters/bitget/preview.ts` provides a deterministic local estimate using fresh product rules, a fresh reference price, an explicit fee rate, and bounded slippage assumptions.

Every preview is hash-bound, carries `LOCAL_LOCKED_ESTIMATE`, warns that it is not an exchange guarantee, and reports `executionAllowed=false`. The adapter's create, cancel, replace, and withdrawal methods permanently throw execution-lock errors.

### Candidate assessment pipeline

`worker/src/live/candidate-command-plan.ts` is a pure, non-mutating assessment pipeline. It combines locked preview evidence, deterministic risk evaluation, and a balanced reservation-journal draft.

The pipeline forces `executionUnlocked=false`, imports no provider submission client, performs no fetch or D1 mutation, and ends only as `REJECTED` or `READY_BUT_EXECUTION_LOCKED`.

### Atomic evidence commit and projection outbox

`worker/src/live/candidate-evidence.ts`, the SQLite-backed `ExchangeAccountCoordinator`, and migration `014_live_candidate_assessment_evidence.sql` persist candidate assessment evidence without creating an execution path.

The Durable Object is the authoritative single-writer boundary. In one synchronous SQLite transaction it commits the immutable assessment envelope, optional balanced reservation draft, coordinator sequence, D1 projection-outbox record, and initial append-only projection event.

D1 is a reporting projection, not a second authoritative transaction participant. The architecture does not claim a distributed transaction between Durable Object SQLite and D1.

`worker/src/live/candidate-projection-retry.ts` and the Durable Object alarm handler provide bounded redelivery: 30-second initial delay, exponential backoff capped at one hour, at most eight attempts, at most 20 due records per alarm, immediate conflict quarantine, and terminal `DEAD_LETTER` state.

### Projection observability and incident acknowledgment

`worker/src/live/observed-account-coordinator.ts` consumes append-only projection events through a Durable Object cursor after the authoritative operation completes. The cursor advances only after successful D1 observability delivery.

`worker/src/live/candidate-projection-observability.ts` emits deterministic projection-lag, attempt-count, conflict, and dead-letter samples. It creates deduplicated critical alerts for lag beyond five minutes, evidence conflicts, and terminal dead letters. Recovered lag remains in immutable incident history.

`ACKNOWLEDGE_ALERT` requires a scoped `RISK_OPERATOR` or `RISK_ADMIN` and a current AAL2/AAL3 `operations` step-up session. The authorization decision is recorded before acknowledgment. Acknowledgment cannot retry projections, apply reservations, alter Guardian state, or unlock execution.

### Pre-trade risk and idempotency

`worker/src/live/risk-engine.ts` requires account eligibility, release authorization, Guardian health, execution unlock, fresh market and product data, clear reconciliation, durable idempotency, sufficient balances, and configured order, daily, position, and open-order limits.

Migration `004_live_idempotency_records.sql` and `worker/src/live/idempotency.ts` implement canonical request hashing, uniqueness by operation scope and key, conflict detection, terminal replay, and recovery-required handling.

### Serialized account boundary and order lifecycle

`ExchangeAccountCoordinator` establishes one SQLite-backed Durable Object per future exchange account. It serializes candidate evidence, reporting retries, and observability delivery while remaining permanently halted for exchange and fund mutations.

`worker/src/live/order-state-machine.ts` defines legal transitions for validation, risk, reservation, preview, submission, open orders, partial fills, cancellation, terminal outcomes, recovery, and settlement. Illegal transitions throw.

### Exact FIFO fill accounting

Migration `005_live_ledger_and_reservations.sql` creates ledger accounts, journals, entries, and reservations. `worker/src/live/ledger.ts` validates balanced journals independently for every asset and builds exact reservation, release, buy-fill, sell-fill, and fee entries.

Migration `015_live_fill_accounting.sql`, `worker/src/live/fill-accounting.ts`, and `worker/src/live/fill-accounting-store.ts` implement exact post-fill accounting:

- balanced spot-fill ledger journals;
- immutable fill-accounting receipts;
- FIFO acquisition lots and immutable lot-consumption records;
- quote-, base-, and explicitly valued third-asset fee handling;
- base-fee quantity adjustments;
- exact realized P&L and cumulative realized P&L;
- current position quantity, total basis, average entry price, and status;
- exact mark-to-market unrealized P&L;
- one transactional D1 batch for the fill, journal, entries, lots, consumptions, realized P&L, position, and receipt.

Accounting receipt replay returns immutable position quantity and cumulative realized P&L. `worker/src/live/fill-accounting-service.ts` quarantines orphaned journals and verifies receipt identity, accounting hash, journal ID, position snapshot, and permanent capability locks.

The fill-accounting service posts internal accounting evidence only. It reports `providerMutationAllowed=false`, `reservationApplied=false`, and `executionAllowed=false`.

### Versioned reservation consumption and terminal release

Migration `016_live_reservation_settlement.sql`, `worker/src/live/reservation-settlement.ts`, and `worker/src/live/reservation-settlement-store.ts` settle a reservation only after an immutable fill-accounting receipt exists.

The pure plan validates the balanced `SPOT_FILL_POSTED` journal and derives the exact consumed amount from credits to the designated reserved ledger account. This includes quote fees for buys and base fees for sells when those fees are sourced from the reservation.

The transactional store:

- verifies the fill-accounting receipt and all permanent capability locks;
- reconstructs the posted fill journal;
- applies an optimistic compare-and-set using consumed amount, status, and monotonic reservation version;
- posts an exact release journal for a terminal unused remainder;
- inserts an immutable request-hash-bound settlement receipt and append-only event in the same D1 batch;
- verifies the resulting reservation state through a database trigger;
- permits only one receipt to claim a given `(reservation_id, next_version)` transition;
- replays identical requests and rejects conflicting terminal or account instructions.

Settlement can move internal reservation state to `PARTIALLY_CONSUMED`, `CONSUMED`, or `RELEASED`. It cannot call an exchange, submit or cancel an order, transfer funds, or enable execution.

### Reconciliation and projections

`worker/src/live/reconciliation.ts` converts exchange observations into deterministic decisions for fills, partial fills, cancellation, rejection, expiration, stale state, missing identifiers, excessive fills, and inconsistent quantities. Ambiguity results in `RECOVERY_REQUIRED` and `HALT_FOR_REVIEW`, never automatic resubmission.

Migration `007_live_exchange_projections.sql` creates isolated live account, product, order, fill, balance, position, and order-event read models.

### Guardian, authorization, queues, transfers, and observability

Migrations 008 through 012 and their TypeScript services provide hierarchical Guardian state, dual-approved reset evidence, role authorization, step-up sessions, separation of duties, queue deduplication, immutable dead letters, isolated transfer state machines, destination screening, time locks, limits, metrics, alerts, acknowledgment, resolution, and immutable alert events.

The withdrawal candidate is a separate Worker with separate placeholder resources and no transfer-provider client.

### Immutable evidence and certification

Migration `006_live_immutable_audit.sql` and `worker/src/live/audit-chain.ts` create a SHA-256 event chain with update, delete, and fork prevention.

Migration `003_live_release_authorizations.sql` binds release authorization to the exact Git SHA, Worker and frontend deployments, schema version, exchange account, product allowlist, limits, expiry, and review references.

Migration `013_live_certification.sql` and `worker/src/live/certification.ts` evaluate mandatory build, security, authorization, exchange, lifecycle, ledger, reconciliation, Guardian, queue, transfer, observability, rollback, and disaster-recovery evidence. Only BTCC or Bitget evidence is accepted, and a passing evidence set still returns `certifiedForLive: false`.

## Validation

CircleCI separately validates legacy Worker contracts, the complete disabled live-foundation suite, BTCC/Bitget provider tests, full and provider typechecks, both dry-run bundles, frontend build, backend audit, and all static safety contracts.

The safety chain proves candidate read-only behavior, command locking, evidence persistence, bounded projection retry, projection observability, acknowledgment isolation, FIFO fill accounting, and versioned reservation settlement.

The accounting tests cover quote/base/third-asset fees, FIFO multi-lot disposal, insufficient basis, deterministic hashes, immutable receipt replay, orphan quarantine, exact reservation consumption, partial/full/terminal settlement, release journals, optimistic version checks, accounting-hash binding, and replay conflicts.

Local migration commands exist for migrations 003 through 016. The branch must remain draft and must not merge while any required check is failed, pending, blocked, skipped, or unavailable.

## Remaining engineering before certification

1. Import and review BTCC's official endpoint and signing manifest; then build its bounded read-only client.
2. Execute Bitget read-only contract tests in an isolated non-live environment using a server-side key that has no write, transfer, or withdrawal authority.
3. Add BTCC and Bitget user-event or polling recovery with sequence, freshness, REST snapshots, and fill-accounting orchestration.
4. Bind the wider reconciliation, queue, alert-delivery, and incident-response pipeline.
5. Build role-scoped frontend account, order-preview, risk, Guardian, reconciliation, audit, deposit, and withdrawal controls.
6. Rehearse rollback, disaster recovery, key rotation, incident response, and provider outage handling.
7. Complete independent security, eligibility, legal, jurisdiction, compliance, and tax review before any separate activation release.

## Activation boundary

No code in this branch authorizes mainnet trading or withdrawals. No real order, deposit, transfer, or withdrawal has been submitted. No exchange credential or candidate evidence secret has been provisioned. Any future activation must be a separate independently reviewed release tied to an exact deployment and must not bypass exchange identity, eligibility, jurisdiction, or account controls.
