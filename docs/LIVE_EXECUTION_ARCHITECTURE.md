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
- Public Worker routes cannot reach the account coordinator or candidate evidence endpoints.
- The account Durable Object remains halted for orders, cancellation, replacement, transfers, and withdrawals.
- Its only mutation is an internally authenticated commit of non-executable assessment evidence, reservation drafts, and projection-outbox records.
- Reservation drafts are constrained to `applied=0` in both authoritative and reporting stores.
- No timeout, ambiguous response, or repeated request authorizes another order submission.
- Preview, assessment, persisted evidence, and projection records always report `executionAllowed=false`.
- Certification evidence can never activate the candidate; `certifiedForLive` is permanently false in this branch.

## Implemented layers

### Provider registry and contracts

`worker/src/live/exchange-registry.ts` enforces BTCC first and Bitget second. Coinbase is marked `marketDataOnly` and `executionDefault=false`.

`worker/src/live/adapters/btcc/contract.ts` requires a dated, SHA-256-bound, HTTPS, GET-only endpoint manifest before a BTCC read client can be implemented. Mutating-looking endpoint names or paths are rejected.

`worker/src/live/adapters/bitget/endpoints.ts` contains the verified read-only spot endpoint allowlist. `worker/src/live/adapters/bitget/read-only-client.ts` implements bounded HMAC-authenticated reads through an injected server-side secret provider. It does not implement order placement, cancellation, replacement, deposit, transfer, or withdrawal requests.

`worker/src/live/adapters/bitget/normalizer.ts` normalizes product rules, balances, orders, and fills using exact decimal strings. Market buys remain quote-sized; the adapter never invents a requested base quantity.

### Exact financial representation

`worker/src/live/decimal.ts` uses BigInt-backed decimal coefficients and explicit scale. It provides canonical parsing, comparison, addition, multiplication, exact downward-rounded division at an explicit scale, signed and non-negative subtraction, increment alignment, and downward quantization.

JavaScript floating-point values are not used for order quantities, notionals, increments, ledger amounts, fees, previews, or reconciliation quantities.

### Product-rule enforcement

`worker/src/live/product-rules.ts` rejects stale or future-dated metadata, disabled products, unsupported order types, ambiguous size bases, increment mismatches, limit violations, and missing or prohibited price fields. It never silently rounds an invalid order into validity.

### Locked Bitget preview

`worker/src/live/adapters/bitget/preview.ts` provides a deterministic local estimate using fresh product rules, a fresh reference price, an explicit fee rate, and bounded slippage assumptions.

The preview calculates exact estimated fill price, base quantity, quote value, fees, total debit, and net credit. It rejects stale prices, product mismatches, invalid provider sizing, excessive fee rates, and excessive slippage assumptions.

Every preview is hash-bound, carries `LOCAL_LOCKED_ESTIMATE`, warns that it is not an exchange guarantee, and reports `executionAllowed=false`. The adapter's create, cancel, replace, and withdrawal methods permanently throw execution-lock errors.

### Candidate assessment pipeline

`worker/src/live/candidate-command-plan.ts` is a pure, non-mutating assessment pipeline. It combines locked preview evidence, deterministic risk evaluation, and a balanced reservation-journal draft.

The pipeline forces `executionUnlocked=false`, imports no provider submission client, performs no fetch or D1 mutation, and ends only as `REJECTED` or `READY_BUT_EXECUTION_LOCKED`. A separate static verifier proves those invariants.

### Atomic evidence commit and projection outbox

`worker/src/live/candidate-evidence.ts`, the SQLite-backed `ExchangeAccountCoordinator`, and migration `014_live_candidate_assessment_evidence.sql` persist the candidate assessment without creating an execution path.

The Durable Object is the authoritative single-writer boundary. In one synchronous SQLite transaction it commits:

- the immutable assessment envelope;
- the optional balanced reservation draft;
- the monotonically increasing coordinator sequence;
- an idempotent D1 projection-outbox record.

The commit is unique by idempotency key, request hash, evidence hash, payload hash, and coordinator sequence. A replay with the same key and request hash returns the stored envelope. Reuse of the key with different evidence is rejected as a conflict.

D1 is a reporting projection, not a second authoritative transaction participant. The projector writes the assessment, reservation draft, and projection receipt in one D1 batch and verifies the receipt hash. Projection failure leaves the authoritative Durable Object commit intact and the outbox pending for a later idempotent retry. The architecture does not claim a distributed transaction between Durable Object SQLite and D1.

The internal coordinator route requires `CANDIDATE_EVIDENCE_TOKEN`, uses a constant-time comparison, enforces a bounded request body, and is not reachable through the public Worker. The candidate configuration does not provision that secret.

### Pre-trade risk

`worker/src/live/risk-engine.ts` requires account eligibility, release authorization, Guardian health, execution unlock, fresh market and product data, clear reconciliation, durable idempotency, sufficient balances, and configured order, daily, position, and open-order limits.

The candidate assessment may demonstrate that every non-execution rule passes, but the forced execution-lock rule keeps the full risk decision unapproved.

### Durable idempotency

Migration `004_live_idempotency_records.sql` and `worker/src/live/idempotency.ts` implement canonical request hashing, uniqueness by operation scope and idempotency key, conflict detection, in-progress responses, terminal replay, and recovery-required handling.

### Serialized account boundary

`ExchangeAccountCoordinator` establishes one SQLite-backed Durable Object per future exchange account. It serializes assessment-evidence commits but remains permanently halted for all exchange and fund mutations.

### Order lifecycle

`worker/src/live/order-state-machine.ts` defines explicit legal transitions for validation, risk, reservation, preview, submission, open orders, partial fills, cancellation, terminal outcomes, recovery, and settlement. Illegal transitions throw.

### Reservations and accounting

Migration `005_live_ledger_and_reservations.sql` creates ledger accounts, journals, entries, and reservations. `worker/src/live/ledger.ts` validates balanced journals independently for every asset and builds exact reservation, release, buy-fill, sell-fill, and fee entries.

The candidate assessment persists a reservation **draft** only. It does not apply the draft, modify an available balance, create an active reservation, or authorize a provider request.

### Reconciliation and projections

`worker/src/live/reconciliation.ts` converts exchange observations into deterministic decisions for fills, partial fills, cancellation, rejection, expiration, stale state, missing identifiers, excessive fills, and inconsistent quantities. Ambiguity results in `RECOVERY_REQUIRED` and `HALT_FOR_REVIEW`, never automatic resubmission.

Migration `007_live_exchange_projections.sql` creates isolated live account, product, order, fill, balance, position, and order-event read models.

### Guardian, authorization, queues, transfers, and observability

Migrations 008 through 012 and their TypeScript services provide:

- hierarchical Guardian state and dual-approved reset evidence;
- role authorization, step-up sessions, revocation, and separation of duties;
- at-least-once queue deduplication and immutable dead-letter records;
- isolated deposit and withdrawal state machines;
- destination screening, time locks, limits, and dual approval;
- operational metrics, deduplicated alerts, acknowledgement, resolution, and immutable alert events.

The withdrawal candidate is a separate Worker with separate placeholder resources and no transfer-provider client.

### Immutable evidence and certification

Migration `006_live_immutable_audit.sql` and `worker/src/live/audit-chain.ts` create a SHA-256 event chain with update, delete, and fork prevention.

Migration `003_live_release_authorizations.sql` binds release authorization to the exact Git SHA, Worker and frontend deployments, schema version, exchange account, product allowlist, limits, expiry, and review references.

Migration `013_live_certification.sql` and `worker/src/live/certification.ts` evaluate mandatory build, security, authorization, exchange, lifecycle, ledger, reconciliation, Guardian, queue, transfer, observability, rollback, and disaster-recovery evidence. Only BTCC or Bitget evidence is accepted, and a passing evidence set still returns `certifiedForLive: false`.

## Validation

The branch defines separate CircleCI gates for:

- legacy Worker contracts;
- the full disabled live-foundation test suite;
- BTCC and Bitget provider and preview tests;
- complete Worker type checking;
- provider-only type checking;
- paper safety;
- live-candidate, command-lock, and evidence-persistence safety;
- regulated-foundation safety;
- certification safety;
- operational and candidate CryptoOps read-only schemas;
- both candidate dry-run bundles;
- frontend build and backend audit tests.

The evidence tests verify deterministic envelopes, execution-lock preservation, reservation-draft extraction, a single D1 transactional batch, replay without duplicate projection, and conflict rejection.

The live tests use Node's `node:test` runner and are excluded from the legacy Vitest contract runner to prevent cross-runner collection.

Local migration commands exist for migrations 003 through 014. The branch must remain draft and must not merge while any required check is failed, pending, blocked, skipped, or unavailable.

## Remaining engineering before certification

1. Import and review BTCC's official endpoint and signing manifest; then build its bounded read-only client.
2. Execute Bitget read-only contract tests in an isolated non-live environment using a server-side key that has no write, transfer, or withdrawal authority.
3. Add autonomous bounded outbox redelivery, dead-letter escalation, and projection-lag alerts without exposing a public mutation route.
4. Complete provider fill-to-ledger processing, positions, fees, cost basis, tax lots, and P&L reconciliation.
5. Add BTCC and Bitget user-event or polling recovery with sequence, freshness, and REST snapshot rules.
6. Bind queues, schedules, retry budgets, dead-letter operations, and production alert delivery.
7. Build role-scoped frontend account, order-preview, risk, Guardian, reconciliation, audit, deposit, and withdrawal controls.
8. Rehearse rollback, disaster recovery, key rotation, incident response, and provider outage handling.
9. Complete independent security, eligibility, legal, jurisdiction, compliance, and tax review before any separate activation release.

## Activation boundary

No code in this branch authorizes mainnet trading or withdrawals. No real order, deposit, transfer, or withdrawal has been submitted. No exchange credential or candidate evidence secret has been provisioned. Any future activation must be a separate independently reviewed release tied to an exact deployment and must not bypass exchange identity, eligibility, jurisdiction, or account controls.
