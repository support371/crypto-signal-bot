# Backend Codex Implementation Instructions

You are implementing the target architecture for `support371/crypto-signal-bot`.

## Operating constraints

- Read `AGENTS.md` and `docs/target-architecture/README.md` first.
- Work only on a feature branch.
- Do not write directly to `main`.
- Do not deploy.
- Do not enable live trading, mainnet, or external withdrawals.
- Keep `TRADING_MODE=paper`, `EXCHANGE_MODE=paper`, `NETWORK=testnet`, and `ALLOW_MAINNET=false`.
- Never commit secrets or credentials.
- Preserve the current stack unless a change is strictly required and justified.
- Implement in small PR-sized phases with tests.

## Architectural target

```text
market-data gateway
→ scout events
→ signal fusion
→ centralized risk decision
→ idempotent paper execution
→ position guardian
→ atomic portfolio ledger
→ protected-profit reserve
→ audit, replay, and monitoring
```

Scouts observe only. The risk engine alone approves capital. External withdrawals remain blocked. Internal profit realization means closing or reducing a paper position and returning proceeds to dashboard cash or the internal protected reserve.

## Phase 1 — Contracts and boundaries

Create typed domain contracts for:

- normalized market event;
- market-integrity status;
- scout observation;
- signal-fusion result;
- risk decision;
- paper-order request/result;
- position state;
- guardian decision;
- portfolio ledger snapshot;
- protected-reserve transfer;
- audit decision event.

Requirements:

- immutable IDs and timestamps;
- explicit schema/version fields;
- `generated_at`, `expires_at`, and price age;
- reason-code arrays;
- no loose untyped dictionaries at financial boundaries;
- serialization tests.

Do not replace existing public DTOs abruptly. Add adapters where necessary.

## Phase 2 — Market integrity

Implement a normalized market-data gateway that:

- records source and exchange timestamp;
- records receipt timestamp and computed age;
- detects sequence gaps where supported;
- tracks heartbeat status;
- classifies quality as verified/recent-cache/stale/static-fallback;
- sets `execution_allowed` deterministically.

Rules:

- stale prices cannot create fills;
- static fallback can support display only;
- market-data failure causes fail-closed order rejection;
- add deterministic fixtures for fresh, recent-cache, stale, and static-fallback states.

## Phase 3 — Scout events and signal fusion

Implement scouts as pure or side-effect-limited evaluators:

- momentum;
- trend;
- volume;
- volatility;
- liquidity/spread;
- reversal;
- market quality.

Each produces a typed observation with confidence, expiry, model version, and evidence.

Implement fusion that:

- requires multiple independent confirmations;
- applies conflict and risk penalties;
- decays confidence with age;
- rejects expired observations;
- records all source event IDs;
- produces a deterministic score and reason codes.

Add unit tests for agreement, conflict, expiry, and missing scouts.

## Phase 4 — Risk and allocation engine

Build one deterministic risk decision boundary.

Inputs:

- fusion result;
- available cash;
- reserved cash;
- protected reserve;
- open exposure;
- correlated exposure;
- current and peak-equity drawdown;
- recent losses;
- guardian state;
- volatility, spread, liquidity;
- cooldown and turnover state;
- market-integrity state.

Outputs:

- approved/rejected;
- approved amount;
- maximum loss budget;
- reserve access flag (default false);
- exit-plan seed;
- reason codes;
- decision ID.

Rules:

- fail closed on unavailable required data;
- scouts and fusion cannot bypass this service;
- protected reserve is excluded from ordinary allocation;
- percentage configuration uses one canonical representation;
- add boundary tests for every rejection reason.

## Phase 5 — Durable idempotent paper execution

Add database-level duplicate protection.

Requirements:

- dedicated `idempotency_key` column;
- unique index or equivalent constraint;
- replay of a duplicate request returns the original result;
- concurrent duplicates produce one financial mutation;
- capital reservation occurs before fill application;
- order and ledger changes are atomic;
- no fill can use stale/static market data;
- fees and slippage fields exist even when configured as zero.

Tests:

- repeated sequential request;
- simultaneous duplicate requests;
- timeout and retry;
- insufficient balance;
- stale price;
- guardian halted;
- partial failure rollback.

## Phase 6 — Position state machine and guardian

Implement valid states:

```text
CANDIDATE → RISK_REVIEW → APPROVED → ENTRY_PENDING → OPEN
→ PROFIT_MANAGEMENT → PARTIALLY_CLOSED → EXIT_PENDING → CLOSED
→ PROFIT_RESERVED → COOLDOWN
```

Reject illegal transitions without changing financial state.

Guardian capabilities:

- fixed partial take-profit;
- volatility-adjusted trailing protection;
- risk-deterioration reduction;
- full close;
- maximum holding-time exit;
- portfolio-wide de-risk recommendation.

The guardian recommends; execution and ledger controls apply the mutation.

## Phase 7 — Portfolio ledger and protected reserve

Track separately:

- available trading cash;
- reserved cash;
- protected-profit reserve;
- cost basis;
- open market value;
- realized PnL;
- unrealized PnL;
- total equity;
- peak equity;
- drawdown.

Implement weighted-average cost basis and correct partial-close accounting.

Profit realization flow:

```text
paper sell
→ release cost basis
→ compute realized PnL
→ credit proceeds
→ move configured share of positive realized PnL to protected reserve
```

Reserve transfer is internal accounting only. It is not an external withdrawal.

Add exact numerical tests for multi-lot buys, partial sells, full closes, loss exits, fees, slippage, and reserve allocation.

## Phase 8 — Audit, replay, and monitoring

Every decision must record:

- decision ID;
- input event IDs;
- model/strategy versions;
- market source and age;
- opportunity and risk scores;
- approved amount;
- reason codes;
- before/after portfolio state hashes;
- result and timestamps.

Add:

- deterministic event replay;
- shadow-mode strategy evaluation;
- latency metrics for each stage;
- stale-data rejection metrics;
- duplicate-prevention metrics;
- portfolio-accounting reconciliation checks.

## API targets

Add or adapt read-only routes for the frontend:

- `GET /architecture/status`
- `GET /market/integrity`
- `GET /scouts/latest`
- `GET /signals/fusion/latest`
- `GET /risk/decisions/latest`
- `GET /positions/guardian`
- `GET /portfolio/ledger`
- `GET /portfolio/protected-reserve`
- `GET /audit/decisions`
- `GET /metrics/latency`

Paper mutation routes may be added only behind existing authentication, runtime, guardian, idempotency, and audit middleware.

## Test standard

For each phase:

1. inspect existing implementation;
2. preserve compatibility or add an adapter;
3. add unit tests;
4. add integration tests where financial state changes;
5. run lint, typecheck, tests, and build;
6. record exact commands and output;
7. stop if paper-mode safety is not confirmed.

## Deliverable format

For each completed phase report:

- files changed;
- functions/routes added;
- migrations added;
- tests added;
- commands run;
- results;
- known gaps;
- safety verification;
- branch and commit SHA.

Do not claim profitability, production readiness, or live readiness without measured evidence.
