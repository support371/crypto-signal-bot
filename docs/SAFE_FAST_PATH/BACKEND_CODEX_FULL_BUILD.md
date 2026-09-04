# Codex Backend Build Specification — Safe Fast Path Phases 3–6

## Mission

Continue the existing `support371/crypto-signal-bot` architecture without rewriting it. Implement the next backend layers for the Safe Fast Path in paper/certification mode only.

Read first:

1. `TARGET_SYSTEM.md`
2. `AGENTS.md`
3. `docs/SAFE_FAST_PATH/README.md`
4. `docs/SAFE_FAST_PATH/TARGET_ARCHITECTURE.md`
5. `docs/SAFE_FAST_PATH/API_CONTRACT.md`
6. `docs/SAFE_FAST_PATH/AGENT_MAINTENANCE_CONTRACT.md`
7. `docs/SAFE_FAST_PATH/IMPLEMENTATION_PLAN.md`

Do not enable provider mutation, live trading, mainnet, external withdrawals, or real-fund execution.

## Required branch discipline

- Start from current `main`.
- Create a focused branch: `feat/safe-fast-path-phase-3-6`.
- Do not write directly to `main`.
- Do not merge.
- Do not deploy.
- Keep production compatibility routes intact.

## Phase 3 — Deterministic scout, fusion, and risk pipeline

Create/complete under `worker/src/fast-path/`:

- `types.ts` — versioned normalized event, scout observation, candidate, risk decision, intent, reason-code types.
- `features.ts` — bounded incremental features only; no full-history recomputation on each event.
- `scouts/momentum.ts`
- `scouts/orderBookImbalance.ts`
- `scouts/liquidity.ts`
- `scouts/reversal.ts`
- `scouts/volatility.ts`
- `scouts/feedDisagreement.ts`
- `fusion.ts` — deterministic weighted/threshold fusion with complete reason record.
- `risk.ts` — sole capital-allocation authority; fail closed on unknown guardian, stale market data, unavailable cash, or missing exposure state.
- `orchestrator.ts` — critical-path coordinator; no Queue, D1 projection, LLM, notification, or analytics call before the portfolio commit.

Requirements:

- scouts observe only;
- fusion cannot size capital;
- risk alone approves/rejects and sizes;
- all decisions are versioned and replayable;
- confidence decays with event age;
- cooldown/churn limits are explicit;
- stale/static/synthetic prices cannot create a new entry.

## Phase 4 — Per-portfolio Durable Object authority

Create/complete under `worker/src/durable-objects/`:

- `PortfolioState.ts`
- `PortfolioDurableObject.ts`
- `ledger.ts`
- `idempotency.ts`
- `exitPolicy.ts`
- `profitReserve.ts`
- `outbox.ts`

Bind one Durable Object per portfolio, never one global singleton.

The Durable Object is the sole writer for hot paper state:

- reusable cash;
- reserved cash;
- protected reserve;
- positions/cost basis;
- fills;
- realized/unrealized PnL;
- equity/peak equity/drawdown;
- cooldown;
- exit-plan state;
- intent idempotency.

One transaction must atomically:

1. check idempotency;
2. verify guardian and action constraints;
3. verify market integrity/freshness;
4. reserve cash/inventory;
5. commit intent;
6. apply entry/reduction/close;
7. model spread, fees, and slippage;
8. update realized PnL and cost basis;
9. apply configured positive-profit reserve sweep;
10. update peak equity and drawdown;
11. persist outbox event;
12. return the committed result.

A failure in any step must not leave a partial portfolio mutation.

## Phase 5 — Position guardian and staged profit realization

Implement the position guardian as deterministic policy, not an LLM decision path.

Required capabilities:

- first partial take-profit/reduction;
- volatility-scaled trailing floor;
- risk-deterioration reduction;
- full close;
- time-based exit;
- portfolio-wide de-risking;
- cooldown after close/stop-out;
- internal protected-profit reserve sweep.

Profit realization is internal. Closing/reducing a position returns proceeds to reusable cash; a configured share of positive realized PnL may move to the protected reserve. External withdrawal remains disabled.

Required decision inputs:

- current/entry/high-water prices;
- current quantity and cost basis;
- net unrealized PnL after estimated costs;
- spread/liquidity;
- volatility;
- reversal and momentum deterioration;
- guardian state;
- feed integrity and data age;
- exit-plan version.

## Phase 6 — Projection, Queue fan-out, R2 replay, and observability

Create/complete:

- `worker/src/projections/portfolioProjection.ts`
- `worker/src/projections/feedHealthProjection.ts`
- `worker/src/queues/outboxConsumer.ts`
- `worker/src/queues/auditConsumer.ts`
- `worker/src/queues/analyticsConsumer.ts`
- `worker/src/queues/alertConsumer.ts`
- `worker/src/replay/` utilities as appropriate

Rules:

- Queue delivery is at-least-once; every consumer is idempotent.
- Queue is never in the decision/portfolio-commit critical path.
- D1 stores read/history projections, not hot transactional authority.
- R2 stores replay/analytics material, not authoritative balances.
- Projection lag is measured.
- Outbox/event ids reconcile Durable Object state and D1 projections.

## `/v2` API work

Implement or complete the contracts in `API_CONTRACT.md`, including:

- `GET /v2/infrastructure/status`
- `GET /v2/market/feeds/status`
- `GET /v2/metrics/decision`
- `GET /v2/portfolios/:portfolioId/summary`
- `POST /v2/portfolios/:portfolioId/intents/paper`

Add read-only status for the architecture stages when useful, but do not invent healthy values. Missing capability is `null` or `not_reported`.

## Required tests

Add deterministic tests covering at minimum:

### Market/integrity
- normal sequence;
- duplicate event;
- out-of-order event;
- sequence gap and recovery;
- heartbeat timeout;
- green/amber/red transitions;
- new entry blocked on amber/red;
- protective reduction on amber only with healthy secondary confirmation;
- static/cache fallback non-executable.

### Scouts/fusion/risk
- each scout deterministic on fixed fixture;
- fusion reason codes stable;
- confidence decay;
- risk fail-closed on missing inputs;
- exposure limit;
- protected reserve excluded from ordinary allocation;
- cooldown/churn rejection.

### Portfolio/idempotency/accounting
- duplicate sequential intent => one fill;
- duplicate concurrent intent => one fill;
- buy cash/cost basis;
- multiple buys weighted cost basis;
- partial sell;
- full sell;
- insufficient cash/quantity;
- realized/unrealized PnL;
- modeled fees/spread/slippage;
- reserve sweep only from positive realized PnL;
- peak-equity drawdown;
- atomic rollback on injected failure.

### Guardian/exit
- staged reduction;
- trailing floor update;
- deterioration exit;
- guardian halt prevents entry;
- exit state persists across object restart;
- cooldown persists.

### Projection/replay
- duplicate Queue event is idempotent;
- out-of-order projection event handled deterministically;
- projection lag metric;
- replay fixture reproduces decisions and portfolio result.

### Compatibility/safety
- existing paper routes still pass;
- live route remains blocked;
- withdrawal route remains blocked;
- mainnet remains false;
- no privileged secret appears in browser-facing config.

## Performance evidence

Provide reproducible local/replay measurements for:

- normalization p50/p95/p99;
- feature update p50/p95/p99;
- scout/fusion/risk p50/p95/p99;
- portfolio commit p50/p95/p99;
- total internal decision latency p50/p95/p99;
- decision data age distribution;
- stale rejection rate;
- duplicate rejection rate;
- projection lag.

Do not call local benchmark numbers exchange or end-to-end network latency.

## Frontend compatibility

The existing `/infrastructure` page expects truthful `/v2` status. Preserve legacy fallback behavior until all `/v2` routes are stable. Do not add privileged credentials to `VITE_*` variables.

## Completion report

Return:

- STATUS;
- branch;
- base SHA and final SHA;
- files created/modified;
- tests run with exact results;
- benchmark environment/results;
- safety invariants verified;
- compatibility notes;
- known limitations;
- rollback boundary;
- next recommended phase;
- explicit confirmation: no merge and no deployment.

Stop if any requested change would enable real-fund execution, mainnet, or external withdrawals. Keep the implementation paper/certification-only.
