# Implementation Plan

## Delivery strategy

Implement the target in reversible phases. Each phase produces code, tests, metrics, and evidence. No phase may silently change the production authority of the simulation ledger.

## Phase 0 — Baseline and protection

### Work

- Preserve current paper-only runtime flags and blocked live/withdrawal routes.
- Add contract tests for existing runtime, guardian, order, and portfolio endpoints.
- Record current p50/p95/p99 request latency and current price-source behavior.
- Add a CI check that fails if a browser-exposed variable contains a privileged backend credential.
- Add a CI check that rejects `ALLOW_MAINNET=true`, non-paper modes, or enabled withdrawals.

### Acceptance gates

- Existing paper-safety verification passes.
- Current frontend and Worker build pass.
- Baseline artifact is stored with commit SHA and test date.
- No deployment is triggered by this phase.

### Rollback

Documentation and tests only; revert the phase commit.

## Phase 1 — Contracts and observability surface

### Work

- Add `/v2/infrastructure/status`.
- Add `/v2/market/feeds/status` with `not_reported` for unavailable fields.
- Add `/v2/metrics/decision`.
- Add trace identifiers and source-event identifiers to decision logs.
- Add the frontend Infrastructure page and navigation entry.

### Acceptance gates

- Frontend never fabricates heartbeat, sequence, Queue, or latency health.
- All new endpoints are read-only.
- Existing routes remain compatible.
- UI shows paper/testnet/mainnet-disabled/withdrawal-disabled state.

### Rollback

Remove the `/v2` read routes and frontend navigation entry; no state migration exists.

## Phase 2 — Market event model and integrity gate

### Work

Create:

```text
worker/src/fast-path/events.ts
worker/src/fast-path/feed-health.ts
worker/src/fast-path/freshness.ts
worker/src/fast-path/normalizers/coinbase.ts
worker/src/fast-path/normalizers/binance.ts
worker/src/fast-path/recovery.ts
```

Implement:

- normalized market-event schema;
- Coinbase level2 and heartbeat handlers;
- Binance bookTicker and diff-depth handlers;
- update-sequence continuity checks;
- hard gap detection and snapshot resync;
- symbol/source health state;
- green/amber/red freshness classification;
- secondary-feed confirmation.

### Tests

- out-of-order message;
- duplicate message;
- skipped sequence;
- stale burst;
- heartbeat loss;
- recovery success;
- recovery timeout;
- static/cache price marked non-executable.

### Acceptance gates

- New entries are impossible outside healthy/green state.
- Protective reduction policy is separately tested.
- `sequence_gap_recovery_ms` is emitted.
- No ledger authority changes yet; feed path runs in shadow mode.

### Rollback

Disable the shadow feed binding and preserve legacy REST reads.

## Phase 3 — Incremental features, scouts, fusion, and risk

### Work

Create:

```text
worker/src/fast-path/features/
worker/src/fast-path/scouts/
worker/src/fast-path/fusion/
worker/src/fast-path/risk/
```

Implement bounded O(1) feature updates where practical:

- spread;
- top-of-book depth;
- imbalance;
- signed trade flow;
- short momentum;
- short reversal;
- realized volatility;
- source disagreement.

Scouts emit evidence only. Fusion is deterministic. Risk alone approves size.

### Tests

- deterministic replay;
- same event stream yields same decision stream;
- risk rejects stale, halted, overexposed, cooldown, and reserve-consuming entries;
- feature state remains bounded;
- no model or scout can bypass risk.

### Acceptance gates

- p95 feature/scout/fusion/risk budget at or below 15 ms in local replay target.
- Every candidate has reason codes and version fields.
- Shadow decisions do not mutate portfolio state.

### Rollback

Disable shadow evaluation; no state authority changes.

## Phase 4 — Portfolio Durable Object

### Work

Create:

```text
worker/src/durable-objects/PortfolioState.ts
worker/src/durable-objects/schema.sql
worker/src/durable-objects/types.ts
worker/src/durable-objects/idempotency.ts
worker/src/durable-objects/accounting.ts
worker/src/durable-objects/exit-policy.ts
```

Add one Durable Object namespace keyed by portfolio id.

Atomic transaction includes:

- idempotency lookup;
- guardian check;
- freshness/integrity validation;
- cash or inventory reservation;
- intent insert;
- entry, partial reduction, or close;
- modeled fees/slippage;
- realized result;
- protected-reserve transfer;
- cooldown and exit-state update;
- outbox insert;
- state-version increment.

### Tests

- two simultaneous identical intents produce one fill;
- transaction failure leaves no partial balance or position change;
- partial close accounting;
- full close accounting;
- reserve transfer;
- insufficient reusable cash while protected reserve exists;
- guardian activation during intent handling;
- deterministic replay of existing idempotency result.

### Acceptance gates

- zero duplicate fills in concurrency tests.
- zero ledger mismatches in property tests.
- p95 transaction target at or below 20 ms in local benchmark.
- Durable Object remains shadow authority during initial release.

### Rollback

Stop shadow writes and retain legacy D1 authority. No production read route points to shadow state.

## Phase 5 — D1 projection and Queue fan-out

### Work

Create:

```text
worker/src/projections/
worker/src/queues/
worker/migrations/003_fast_path_projections.sql
```

Implement idempotent outbox projection for:

- intents;
- fills;
- positions;
- portfolio summaries;
- reserve transfers;
- feed health;
- latency spans;
- audit records.

Queue consumers may retry safely. Projection lag is measured.

### Tests

- duplicate Queue delivery;
- out-of-order projection event;
- delayed consumer;
- poison event and dead-letter behavior;
- D1 outage with Durable Object commit preserved;
- eventual replay from outbox.

### Acceptance gates

- at-least-once delivery never duplicates a projection row.
- D1 failure does not invalidate committed portfolio state.
- projection lag is visible in `/v2/infrastructure/status`.

### Rollback

Pause consumers and replay later from the Durable Object outbox.

## Phase 6 — Hybrid exits, reserve, and anti-churn

### Work

Implement versioned policies for:

- initial reduction fraction;
- volatility-scaled trailing floor;
- passive repost eligibility in simulation;
- protected-reserve fraction;
- cooldown after reduction, close, or stop-out;
- portfolio-level de-risking under drawdown or volatility.

### Tests

- first reduction triggers once;
- trailing floor moves only in the protective direction;
- reserve cannot be allocated by ordinary entry logic;
- cooldown prevents immediate re-entry;
- guardian overrides all policies;
- adverse-selection and fee/slippage assumptions are included in replay.

### Acceptance gates

- `profit_capture_ratio`, churn, adverse move, and post-exit regret are reported.
- Policy versions are stored with every intent and fill.
- No change is promoted based only on gross simulated result.

### Rollback

Select the previous versioned exit/risk policy.

## Phase 7 — Shadow comparison and authority cutover

### Work

Run legacy and target paths on the same market stream.

Compare:

- decisions;
- rejects;
- source age;
- latency;
- fills;
- accounting;
- drawdown;
- reserve behavior;
- projection lag.

Cutover order:

1. target feed health becomes authoritative;
2. target risk decisions remain shadow until reviewed;
3. Durable Object becomes authoritative for a dedicated test portfolio;
4. frontend reads `/v2` for that portfolio;
5. legacy write route is disabled for that portfolio;
6. expand only after stable evidence.

### Acceptance gates

- minimum replay and observation window is completed.
- no ledger atomicity failure.
- no duplicate fill.
- no stale entry.
- paper-safety checks pass.
- rollback drill succeeds.
- owner explicitly approves production simulation cutover.

### Rollback

Route the test portfolio back to legacy authority using a versioned routing flag. Preserve both ledgers and reconcile by event id.

## Phase 8 — Frontend completion

### Work

Move infrastructure UI into:

```text
src/features/infrastructure/api.ts
src/features/infrastructure/types.ts
src/features/infrastructure/hooks.ts
src/features/infrastructure/components/
src/features/infrastructure/pages/Infrastructure.tsx
```

The initial `src/lib/infrastructureApi.ts` adapter may be retained as a compatibility export.

Add views for:

- runtime safety;
- guardian;
- feed sequence and heartbeat;
- freshness class;
- decision latency and event age;
- current state authority;
- Queue projection lag;
- duplicate/stale rejects;
- reserve and accounting integrity;
- migration phase and readiness gates.

### Acceptance gates

- unavailable fields are visibly unavailable.
- the page is read-only.
- secrets are absent from the bundle.
- accessibility and responsive layout tests pass.
- frontend contract tests pass against legacy and `/v2` responses.

## Required CI matrix

| Lane | Trigger | Required checks |
|---|---|---|
| Unit | every PR | freshness, sequence, features, fusion, risk, accounting |
| Contract | every PR | existing API compatibility and `/v2` schema |
| Property | every PR | one fill per idempotency key; ledger invariants |
| Replay | fast-path PRs | historical event replay and deterministic output |
| Fault injection | nightly | gaps, stale data, heartbeat loss, Queue duplication |
| Concurrency | nightly | simultaneous intent mutation |
| Performance | nightly | p50/p95/p99 stage budgets |
| Observability | nightly | required trace and metric fields |
| Paper safety | every PR and deploy | mainnet/live/withdrawal blocks |
| Frontend bundle | every PR | no privileged secret or forbidden fallback |

## Final definition of done

The migration is complete only when the target path is the measured simulation authority, the legacy path is retired or explicitly retained as fallback, all acceptance gates pass, the frontend reports the real system state, and no claim of readiness depends on unmeasured or fabricated values.
