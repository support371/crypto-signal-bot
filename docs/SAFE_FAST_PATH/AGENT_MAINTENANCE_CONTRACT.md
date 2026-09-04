# Safe Fast Path — Agent Maintenance Contract

This document defines how any agent, engineer, or reviewer must preserve the target architecture while improving it.

## 1. Architecture invariants

The required chain is:

```text
market integrity -> scouts -> fusion -> risk -> portfolio authority -> paper execution -> position guardian -> profit reserve -> projections
```

Do not skip authority boundaries. A scout cannot become an executor. A signal cannot become a capital allocation. A frontend control cannot become a privileged execution credential.

## 2. Speed model

Optimize the critical path by:

- streaming data instead of repeated polling;
- incremental feature updates instead of full-history recomputation;
- bounded deterministic scouts in parallel;
- one deterministic fusion step;
- one risk decision;
- one coordinated portfolio commit;
- asynchronous projections outside the commit path.

Measure two different quantities:

- `decision_latency_ms`: receive-to-commit processing time;
- `decision_data_age_ms`: exchange-event timestamp to committed decision time.

A fast decision on stale data is not considered fast-path success.

## 3. Market integrity

Each executable source must report connection, heartbeat, sequence continuity, event age, and recovery state. New entries require healthy/green data. Degraded/amber data may only support a protective reduction when a healthy secondary source confirms it. Red/unavailable data is display-only.

## 4. Scout contract

Each scout returns a versioned observation:

- event id;
- symbol;
- score;
- confidence;
- feature version;
- rule/model version;
- source age;
- reason codes.

Scouts may cover momentum, order-book imbalance, liquidity/spread, short-horizon reversal, realized volatility, feed disagreement, and future research modules. They never write portfolio state.

## 5. Risk contract

The risk engine is the only capital authority. It must fail closed when guardian state, market freshness, balance, or exposure data is unknown. It evaluates reusable cash, protected reserve, exposure, drawdown, volatility, liquidity, cooldown, churn, existing positions, and execution policy.

## 6. Portfolio and profit protection

The portfolio state owner atomically maintains:

- reusable cash;
- reserved cash;
- protected profit reserve;
- positions and cost basis;
- fills;
- realized/unrealized PnL;
- equity and peak equity;
- drawdown;
- cooldown and exit-policy state;
- idempotency keys.

Profit realization means reducing/closing an internal position and returning proceeds to the dashboard balance. It is not an external withdrawal. A configurable share of positive realized PnL may be swept to the protected reserve.

## 7. Exit policy

The position guardian may perform:

- first staged reduction;
- volatility-scaled trailing protection;
- risk-deterioration reduction;
- full close;
- time-based exit;
- portfolio-wide de-risking;
- cooldown enforcement.

Exit decisions must model spread, fees, slippage, and current data integrity. No mechanism guarantees a specific profit.

## 8. Idempotency and concurrency

Every executable intent carries a deterministic idempotency key. One key may produce at most one committed fill. Duplicate delivery, retries, and concurrent requests must return the original committed result or a deterministic conflict without mutating the portfolio twice.

## 9. Projection and replay

D1 remains the read/history projection store. R2 may store replay and analytics datasets. Queue consumers are idempotent and outside the critical path. Durable hot state and projected read models must be reconcilable through an outbox/event id.

## 10. Frontend contract

The Infrastructure page is the operator-facing representation of this architecture. It must show:

- current versus target authority;
- paper/testnet safety state;
- market feed integrity;
- decision latency and data age;
- queue/projection state;
- architecture stages and authority boundaries;
- protected-reserve semantics;
- migration gaps.

Unknown values must be `Not reported`, not invented as healthy.

## 11. Required change evidence

Any PR touching this target must include:

- branch and base SHA;
- files changed;
- tests and exact results;
- latency or replay evidence when relevant;
- safety confirmation;
- compatibility notes;
- rollback boundary;
- known limitations.
