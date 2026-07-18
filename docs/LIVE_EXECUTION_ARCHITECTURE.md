# Live Execution Architecture — Disabled Candidate

## Status

This branch contains the disabled foundation of a future real-money-capable execution system. It does not enable live trading, deposits, transfers, or withdrawals.

The live-candidate Worker has no public financial-mutation route or cron trigger and always reports `liveReady: false`. No candidate exchange credential, signing secret, or execution token is provisioned.

## Canonical exchange policy

The provider order is fixed in code and configuration:

1. **BTCC** — primary intended execution target.
2. **Bitget** — secondary intended execution target and current default public market-data source.

`bitgate` is treated only as a legacy spelling of `Bitget`.

Coinbase is optional public/read-only data support. It is not a default execution exchange and cannot be certified as the execution provider for this candidate.

BTCC remains fail-closed until an official dated, SHA-256-bound endpoint and signing manifest is imported and reviewed. No BTCC API host, endpoint, signing rule, precision rule, status, or permission model may be guessed.

Bitget currently has strict spot normalizers, an authenticated read-only REST transport, a local locked preview, deterministic unsigned mutation candidates, and mandatory read-only recovery instructions. No Bitget write transport or signing path exists in this branch.

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
- Public Worker routes cannot reach candidate evidence, recovery approval, dispatch, fill accounting, reconciliation, reservation settlement, or transfer workflows.
- The account Durable Object remains halted for exchange orders, cancellations, replacements, transfers, and withdrawals.
- Durable Object alarms retry D1 reporting projections and observability delivery only.
- Candidate reservation drafts remain constrained to `applied=0`.
- Timeout, ambiguous response, duplicate client ID, alarm retry, alert acknowledgment, evidence replay, and repeated requests never authorize automatic provider resubmission.
- Preview, assessment, unsigned provider candidates, persisted evidence, projection records, accounting receipts, settlement receipts, approvals, validity records, and dispatch receipts permanently deny provider mutation and execution.
- Certification evidence can never activate the candidate; `certifiedForLive` remains false in this branch.

## Implemented layers

### Provider registry and read-only contracts

`worker/src/live/exchange-registry.ts` enforces BTCC first and Bitget second. Coinbase is marked market-data-only and non-default for execution.

`worker/src/live/adapters/btcc/contract.ts` requires a dated, SHA-256-bound, HTTPS, GET-only endpoint manifest before a BTCC read client can be implemented. Mutating-looking endpoint names or paths are rejected.

`worker/src/live/adapters/bitget/endpoints.ts` contains the read-only spot endpoint allowlist. `worker/src/live/adapters/bitget/read-only-client.ts` implements bounded HMAC-authenticated reads through an injected server-side secret provider. It rejects redirects, excessive requests/responses, non-GET endpoints, and API-key authorities that include trading, transfer, or withdrawal permission.

`worker/src/live/adapters/bitget/normalizer.ts` normalizes product rules, balances, orders, and fills with exact decimal strings. Market buys remain quote-sized; the adapter never invents a requested base quantity.

### Disabled Bitget execution-candidate evidence

`worker/src/live/adapters/bitget/execution-candidate.ts` records deterministic, unsigned evidence for future Bitget spot place, cancel, and cancel-replace operations.

The candidate builder:

- validates exact product rules and sizing;
- preserves quote sizing for market buys;
- binds place evidence to a locked preview hash and client order ID;
- builds mandatory read-only order-lookup instructions for ambiguous results;
- models both identities for cancel-replace split outcomes;
- classifies authorization failures, rate limits, duplicate client IDs, transport ambiguity, identity mismatches, and terminal rejection;
- sets `providerMutationAllowed=false`, `executionAllowed=false`, `automaticRetryAllowed=false`, `transportSelected=false`, and `signingMaterialPresent=false`.

The class contains no fetcher, secret provider, HMAC signer, or callable write transport. Its submission methods permanently throw `CandidateExecutionLockedError`.

`worker/src/live/bitget-locked-order-command.ts` binds the local preview, deterministic risk result, balanced reservation draft, unsigned provider candidate, and their hashes into one command-evidence object. A rejected assessment creates no provider candidate. A ready assessment remains `READY_BUT_EXECUTION_LOCKED`, cannot outlive its preview, is never submitted automatically, and still reports all execution capabilities as false.

### Exact financial representation

`worker/src/live/decimal.ts` uses BigInt-backed coefficients and explicit scale. It provides canonical parsing, comparison, addition, multiplication, exact downward-rounded division, signed and non-negative subtraction, increment alignment, and downward quantization.

JavaScript floating-point values are not used for order quantities, notionals, increments, ledger amounts, fees, previews, FIFO allocation, P&L, or reconciliation quantities.

### Product rules and locked preview

`worker/src/live/product-rules.ts` rejects stale or future-dated metadata, disabled products, unsupported order types, ambiguous size bases, increment mismatches, limit violations, and missing or prohibited price fields. It never rounds an invalid order into validity.

`worker/src/live/adapters/bitget/preview.ts` provides a deterministic local estimate using fresh product rules, a fresh reference price, an explicit fee rate, and bounded slippage. Every preview is hash-bound, carries `LOCAL_LOCKED_ESTIMATE`, warns that it is not an exchange guarantee, and reports `executionAllowed=false`.

### Candidate assessment and authoritative evidence

`worker/src/live/candidate-command-plan.ts` combines locked preview evidence, deterministic risk evaluation, and a balanced reservation-journal draft. It forces `executionUnlocked=false`, performs no provider call or D1 mutation, and ends only as `REJECTED` or `READY_BUT_EXECUTION_LOCKED`.

`worker/src/live/candidate-evidence.ts`, the SQLite-backed account Durable Object, and migration `014_live_candidate_assessment_evidence.sql` persist immutable assessment and reservation-draft evidence.

The Durable Object is the authoritative single-writer boundary. In one synchronous SQLite transaction it commits the assessment envelope, optional reservation draft, coordinator sequence, D1 projection-outbox record, and initial append-only projection event. D1 is an idempotent reporting projection, not a second participant in a distributed transaction.

`worker/src/live/candidate-projection-retry.ts` provides bounded alarm redelivery: a 30-second initial delay, exponential backoff capped at one hour, at most eight attempts, at most 20 due records per alarm, immediate conflict quarantine, and terminal `DEAD_LETTER` state.

### Projection observability and acknowledgment

`worker/src/live/observed-account-coordinator.ts` consumes append-only projection events through a Durable Object cursor after the authoritative operation completes. The cursor advances only after successful D1 observability delivery.

`worker/src/live/candidate-projection-observability.ts` emits projection-lag, attempt-count, conflict, and dead-letter samples and creates deduplicated critical alerts. Recovered lag remains in immutable incident history.

`ACKNOWLEDGE_ALERT` requires a scoped `RISK_OPERATOR` or `RISK_ADMIN` and a current AAL2/AAL3 `operations` step-up session. Acknowledgment cannot retry projections, apply reservations, alter Guardian state, or unlock execution.

### Exact FIFO fill accounting and reconciliation

Migrations `005_live_ledger_and_reservations.sql` and `015_live_fill_accounting.sql` plus the accounting services implement:

- per-asset balanced journals;
- immutable fill-accounting receipts;
- FIFO acquisition lots and lot-consumption records;
- quote-, base-, and explicitly valued third-asset fees;
- exact realized and cumulative P&L;
- exact position quantity, basis, average entry price, and mark-to-market unrealized P&L;
- one transactional D1 batch for fill, journal, entries, lots, consumptions, P&L, position, and receipt;
- immutable replay verification and orphan-journal quarantine.

Accounting remains internal-only and permanently reports `providerMutationAllowed=false`, `reservationApplied=false`, and `executionAllowed=false`.

The reconciliation services compare FIFO lots, position state, ledger inventory, cumulative realized P&L, optional exchange balances, and mark-to-market P&L. Mismatches return `HALT_FOR_REVIEW`; they never trigger automatic provider action.

### Versioned reservation settlement

Migration `016_live_reservation_settlement.sql` and its services settle a reservation only after an immutable fill-accounting receipt exists. They derive exact consumption from the balanced fill journal, use monotonic reservation versions and optimistic compare-and-set, release terminal unused remainder through a balanced journal, and store immutable settlement evidence. Settlement cannot call an exchange or authorize execution.

### Read-only recovery and accounting planning

Bitget REST and user-stream recovery boundaries fail closed on initial snapshot requirements, gaps, stale heartbeats, timestamp regressions, conflicting identities, malformed events, and ambiguous fees.

`worker/src/live/bitget-recovery-accounting-plan.ts` converts a complete read-only recovery snapshot into ordered accounting commands only when every fill has an internal-order binding, ledger-account scope, canonical product match, and exact third-asset fee quote valuation. Fee valuations are runtime-normalized as canonical non-negative decimal strings; TypeScript casts cannot bypass the check.

Plans are deterministic, hash-bound, and permanently set `automaticallyDispatched=false`, `providerMutationAllowed=false`, `reservationApplied=false`, and `executionAllowed=false`.

### Independent approval, time-bound validity, and accounting dispatch evidence

Migration `018_live_recovery_accounting_approval.sql` stores immutable plans, authorization events, and independent risk-operator approval or denial evidence. The plan preparer cannot approve the same plan, and approval requires a current operations step-up session.

Migration `018_live_recovery_accounting_dispatch.sql` stores immutable accounting-dispatch summaries and per-command receipts. Dispatch invokes only serialized accounting persistence, stops at the first failure, and never retries automatically or calls an exchange.

Migration `019_live_recovery_accounting_approval_validity.sql` caps approved dispatch validity at 15 minutes and at the step-up session expiry. It also prevents more than one completed dispatch per plan.

The verified and fresh approval packages use module-private symbol brands defined with `enumerable:false`, `configurable:false`, and `writable:false`. Object spread and ordinary serialization therefore remove authority. A fresh derived package receives the verified brand again only after its immutable source brand is runtime-checked.

Local migration commands apply approval evidence, dispatch evidence, and validity evidence explicitly in dependency order.

### Guardian, authorization, queues, transfers, and audit

Migrations 006 and 008 through 013 plus their services provide a SHA-256 audit chain, hierarchical Guardian state, dual-approved reset evidence, scoped authorization, step-up sessions, separation of duties, queue deduplication, immutable dead letters, isolated transfer lifecycles, destination screening, time locks, metrics, alerts, release authorization, and certification evidence.

The withdrawal candidate is a separate disabled Worker with separate placeholder resources and no transfer-provider client.

## Validation

CircleCI separately validates:

- legacy Worker contracts;
- the complete disabled live-foundation suite;
- named core, accounting, recovery-contract, legacy-provider, and transfer test shards;
- BTCC/Bitget provider tests;
- recovery ingestion, approval, dispatch, freshness, validity, and store tests;
- full and provider TypeScript compilation;
- both disabled dry-run bundles;
- frontend build and backend audit;
- static safety contracts for execution locks, persistence, retries, observability, accounting, settlement, recovery, approval, certification, paper isolation, and CryptoOps read-only schemas.

The safety chain enforces the absence of exchange write transport, public financial-mutation routes, automatic retries, enumerable approval brands, true execution flags, and provider-mutation capability.

The branch must remain draft and must not merge while any required check is failed, pending, blocked, skipped, or unavailable.

## Remaining engineering before certification

1. Import and review BTCC's official endpoint and signing manifest; then build its bounded read-only client.
2. Execute Bitget read-only contract tests in an isolated non-live environment using a server-side key controlled by an eligible authorized operator and restricted to no write, transfer, or withdrawal authority.
3. Complete provider-event and polling recovery orchestration with freshness, REST snapshots, fill accounting, settlement, reconciliation, and incident evidence.
4. Build role-scoped frontend account, preview, risk, Guardian, reconciliation, audit, deposit, and withdrawal controls.
5. Rehearse rollback, disaster recovery, key rotation, incident response, and provider outage handling.
6. Complete independent security, eligibility, legal, jurisdiction, compliance, and tax review before any separate activation release.

## Activation boundary

No code in this branch authorizes mainnet trading or withdrawals. No real order, deposit, transfer, or withdrawal has been submitted. No exchange credential or candidate evidence secret has been provisioned. Any future activation must be a separate independently reviewed release tied to an exact deployment and eligible authorized account ownership.
