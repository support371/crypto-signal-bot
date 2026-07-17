# Live Execution Architecture — Disabled Candidate

## Status

This branch contains a production-oriented foundation for a future real-money-capable execution system. It does not enable live trading, deposits, or withdrawals.

The live-candidate Worker is intentionally read-only and always reports `liveReady: false`.

## Safety invariants

- `ALLOW_MAINNET=false` by default.
- `LIVE_EXECUTION_ENABLED=false` by default.
- `WITHDRAWALS_ENABLED=false` by default.
- No exchange credential exists in source, configuration, D1, KV, R2, browser storage, or tests.
- Legacy live, order, and withdrawal routes return HTTP 403.
- Every non-safe HTTP method returns HTTP 403.
- Sensitive reads fail closed when operator authentication is absent.
- Candidate resources use isolated names and placeholder IDs, preventing accidental production deployment.
- No routes or cron triggers are attached to the candidate configuration.
- The account Durable Object accepts health reads only and rejects commands with HTTP 423.

## Implemented layers

### Exact financial representation

`worker/src/live/decimal.ts` uses BigInt-backed decimal coefficients and explicit scale. It provides canonical parsing, comparison, addition, multiplication, signed subtraction, non-negative subtraction, increment alignment, and downward quantization.

JavaScript floating-point values are not used for order quantities, notionals, product increments, ledger amounts, or reconciliation quantities in this foundation.

### Product-rule enforcement

`worker/src/live/product-rules.ts` normalizes exchange product metadata and rejects:

- stale or future-dated product rules;
- disabled products;
- unsupported order types;
- ambiguous order-size bases;
- values not exactly aligned to exchange increments;
- values below minimum or above maximum sizes;
- missing or prohibited limit and stop prices.

The validator never silently rounds an order into validity.

### Deterministic pre-trade risk

`worker/src/live/risk-engine.ts` requires all mandatory gates to pass, including account eligibility, release authorization, Guardian health, execution unlock, fresh feeds and product rules, clear reconciliation, durable idempotency, available balances, and configured order, daily, position, and open-order limits.

### Durable idempotency

Migration `004_live_idempotency_records.sql` and `worker/src/live/idempotency.ts` implement request hashing, uniqueness by operation scope and idempotency key, conflict detection, in-progress responses, terminal replay, and recovery-required handling.

No timeout or repeated request is interpreted as permission to submit another exchange order.

### Serialized account boundary

`ExchangeAccountCoordinator` establishes one SQLite-backed Durable Object per future exchange account. In this candidate it is permanently halted and accepts no financial command.

### Order lifecycle

`worker/src/live/order-state-machine.ts` defines explicit legal transitions for validation, risk, reservation, preview, submission, open orders, partial fills, cancellation, terminal outcomes, recovery, and settlement.

Illegal transitions throw and must never be silently accepted.

### Reservations and double-entry accounting

Migration `005_live_ledger_and_reservations.sql` creates ledger accounts, journals, entries, and reservations.

`worker/src/live/ledger.ts` validates balanced journals independently for every asset and builds exact reservation, release, buy-fill, sell-fill, and fee entries.

Financial balances must not be changed without a balanced journal.

### Reconciliation

`worker/src/live/reconciliation.ts` converts exchange observations into deterministic decisions. It handles full fills, active and terminal partial fills, cancellation, rejection, expiration, stale orders, missing IDs, inconsistent remaining quantities, excessive fills, and unknown statuses.

Ambiguity results in `RECOVERY_REQUIRED` and `HALT_FOR_REVIEW`; it never results in automatic resubmission.

### Immutable audit chain

Migration `006_live_immutable_audit.sql` creates an append-only audit table with update and delete prevention. A unique predecessor constraint prevents a chain fork.

`worker/src/live/audit-chain.ts` canonicalizes event payloads, creates SHA-256 event chains, appends events, and verifies chain integrity.

### Release authorization

Migration `003_live_release_authorizations.sql` and `worker/src/live/release-gate.ts` bind authorization to an exact Git SHA, Worker deployment, frontend deployment, schema version, exchange account reference, product allowlist, limits, expiration, and security and compliance review references.

A live-candidate build remains unable to execute even when every prerequisite record is present.

## Verification

The branch includes:

- Node runtime tests for exact decimals, idempotency hashing, product rules, risk, ledger balancing, reconciliation, and audit chains;
- full Worker TypeScript type checking;
- local migration application for migrations 003 through 006;
- a static live-candidate safety verifier;
- a Wrangler dry-run bundle;
- a dedicated GitHub Actions safety workflow;
- continued CircleCI paper-path validation.

## Remaining engineering before any live-capable certification

The following remain unimplemented or uncertified:

1. Native authenticated exchange adapter contracts and provider-specific schemas.
2. Exchange order preview integration.
3. User-order WebSocket and REST snapshot recovery.
4. Durable order, fill, balance, position, and product projections.
5. Coordinator command processing while maintaining the execution lock.
6. Hierarchical Guardian persistence and dual-approved reset.
7. Deposit observation lifecycle.
8. Separately deployed withdrawal service with isolated credentials and dual approval.
9. User roles, step-up authentication, session revocation, and approval separation.
10. Queues, dead-letter handling, alert delivery, and reconciliation scheduling.
11. Frontend live-candidate account, order, risk, reconciliation, and audit interfaces.
12. Disaster-recovery rehearsal, key-rotation rehearsal, and rollback certification.
13. Independent security, legal, eligibility, compliance, and tax review.
14. Provider credentials provisioned outside the repository by an eligible authorized account owner.

## Activation boundary

No code in this branch authorizes mainnet trading or withdrawals. No real funds have moved. A future activation must be a separate reviewed release and must not bypass exchange identity, age, jurisdiction, or account-eligibility requirements.
