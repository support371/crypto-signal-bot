# Target Trading Infrastructure Standard

Status: **authoritative target architecture**  
Current execution mode: **paper/simulation only**  
Applies to: Worker, FastAPI services, frontend, data stores, monitoring, and agent workflows

This document preserves the intended operating pattern while strengthening speed, reliability, auditability, and capital protection.

## 1. Core operating pattern

```text
Market data gateway
→ independent scout agents
→ signal-fusion engine
→ centralized risk engine
→ execution engine
→ position guardian
→ portfolio ledger
→ protected-profit reserve
→ monitoring, audit, and replay
```

The scouts observe. The signal engine interprets. The risk engine approves or rejects. The execution engine acts. The position guardian manages open risk. The ledger records every mutation. The reserve protects a configurable share of realized profit.

## 2. Non-negotiable design rules

1. Scouts never allocate capital and never submit orders.
2. The risk engine is the only capital-allocation authority.
3. Every order request has an idempotency key enforced by a database uniqueness constraint.
4. Financial mutations are atomic and auditable.
5. Stale or static fallback prices are display-only and cannot create fills.
6. Missing guardian, portfolio, or market-integrity data causes a fail-closed rejection.
7. External withdrawals remain blocked.
8. Internal profit realization is allowed in paper mode: reduce or close a position, credit proceeds to dashboard cash, calculate realized PnL, and optionally move part of profit into an internal protected reserve.
9. No component may claim guaranteed returns or certain future price prediction.
10. Live trading, mainnet execution, and external transfers remain outside the current implementation scope.

## 3. Two-speed architecture

### Fast path

Used for low-latency market response:

```text
stream event
→ integrity gate
→ incremental features
→ scout events
→ fusion score
→ risk decision
→ idempotent paper order
→ position update
```

Fast-path requirements:

- streaming-first market data;
- sequence-gap and heartbeat checks;
- incremental indicators instead of full-history recomputation;
- parallel scout evaluation;
- one centralized risk decision;
- bounded latency budgets;
- immediate stale-data rejection;
- single coordinated writer per portfolio.

### Control path

Used for slower analytical and operational work:

- backtesting;
- strategy research;
- model comparison;
- historical replay;
- shadow-mode evaluation;
- daily performance reports;
- monitoring and incident analysis;
- documentation and audit.

The control path must never block the fast path.

## 4. Market-data gateway

Every normalized market event must include:

```json
{
  "symbol": "BTC-USD",
  "price": 65000,
  "source": "coinbase",
  "exchange_timestamp": "ISO-8601",
  "received_at": "ISO-8601",
  "age_ms": 180,
  "sequence_number": 123456,
  "sequence_gap": false,
  "heartbeat_ok": true,
  "quality": "verified",
  "execution_allowed": true
}
```

Execution policy:

```text
fresh verified source          → executable
recent cache within hard limit → optionally executable
stale cache                    → monitoring only
static fallback                → display only
```

## 5. Scout layer

Recommended scouts:

- momentum;
- trend;
- volume;
- volatility;
- liquidity/spread;
- reversal;
- cross-market confirmation;
- market-quality/freshness.

Scout output contract:

```json
{
  "event_id": "uuid",
  "event_type": "MOMENTUM_INCREASING",
  "symbol": "BTC-USD",
  "confidence": 0.78,
  "generated_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "model_version": "momentum-v1",
  "evidence": {}
}
```

Signals decay with age and expire. Repeated events are deduplicated by `event_id`.

## 6. Signal-fusion engine

The fusion engine combines independent evidence and conflict penalties.

```text
momentum
+ trend
+ volume
+ liquidity
+ cross-market confirmation
− volatility penalty
− reversal penalty
− stale-data penalty
= net opportunity score
```

Example output:

```json
{
  "symbol": "BTC-USD",
  "candidate": "BUY",
  "opportunity_score": 81,
  "risk_indication": 29,
  "net_score": 52,
  "confidence": 0.76,
  "expires_at": "ISO-8601",
  "status": "SEND_TO_RISK_ENGINE"
}
```

A single scout can never trigger execution.

## 7. Risk and allocation engine

The risk engine receives a candidate and returns a deterministic decision.

Inputs include:

- available trading cash;
- reserved cash;
- protected reserve;
- existing exposure;
- correlation exposure;
- current drawdown;
- recent losses;
- volatility and spread;
- guardian status;
- market freshness;
- cooldown state;
- maximum open positions;
- loss budget.

Example decision:

```json
{
  "approved": true,
  "approved_amount": 75,
  "maximum_loss_budget": 3,
  "reserve_access_allowed": false,
  "reason_codes": ["CONSENSUS_PASSED", "EXPOSURE_WITHIN_LIMIT"]
}
```

The risk engine fails closed when required inputs are unavailable.

## 8. Execution engine

Execution sequence:

```text
validate runtime paper mode
→ validate market freshness
→ validate guardian
→ validate available balance
→ reserve capital
→ enforce idempotency
→ submit paper order
→ confirm simulated fill
→ apply atomic ledger update
→ attach exit plan
→ write audit event
```

Required order fields:

- `order_id`;
- `idempotency_key`;
- `decision_id`;
- `strategy_version`;
- `price_source`;
- `price_age_ms`;
- `requested_quantity`;
- `filled_quantity`;
- `fees`;
- `slippage`;
- `status`;
- timestamps.

## 9. Position guardian

The position guardian runs independently of the general scanning cycle.

It tracks:

- entry price;
- current price;
- highest price since entry;
- cost basis;
- unrealized and realized PnL;
- volatility;
- trend and reversal scores;
- holding time;
- remaining quantity;
- active exit plan.

Supported actions:

- hold;
- tighten protection;
- partial take-profit;
- reduce exposure;
- full close;
- emergency de-risk;
- pause new entries.

The guardian may recommend an action, but all financial mutation still passes through the execution and ledger controls.

## 10. Profit realization and protected reserve

This is not an external withdrawal.

```text
profitable position
→ partial or full paper sell
→ release original capital
→ calculate realized profit
→ credit dashboard available cash
→ move configured profit share to protected reserve
```

Required balances:

- `available_trading_cash`;
- `reserved_for_pending_orders`;
- `protected_profit_reserve`;
- `invested_cost_basis`;
- `open_position_market_value`;
- `unrealized_pnl`;
- `realized_pnl`;
- `total_equity`.

The protected reserve is excluded from ordinary allocation unless an explicit policy allows release.

## 11. Position state machine

```text
CANDIDATE
→ RISK_REVIEW
→ APPROVED
→ ENTRY_PENDING
→ OPEN
→ PROFIT_MANAGEMENT
→ PARTIALLY_CLOSED
→ EXIT_PENDING
→ CLOSED
→ PROFIT_RESERVED
→ COOLDOWN
```

Illegal transitions must return a typed error and leave financial state unchanged.

## 12. Portfolio coordination

Use one coordinated writer per paper portfolio/account for:

- balance reservation;
- order lifecycle;
- duplicate rejection;
- fill application;
- position updates;
- realized PnL;
- reserve movement.

D1 remains the durable reporting and audit ledger. A coordination primitive such as a Durable Object may be introduced only after tests prove deterministic behavior and recovery.

## 13. Anti-churn controls

- symbol cooldown after exit;
- maximum trades per symbol per period;
- minimum score improvement before re-entry;
- turnover limits;
- fee and slippage thresholds;
- repeated-signal suppression;
- reversal confirmation window.

## 14. Audit contract

Every decision records:

- decision ID;
- event IDs used;
- symbol;
- action;
- opportunity score;
- risk score;
- approved amount;
- strategy/model versions;
- market-data source and age;
- reason codes;
- before/after portfolio state hashes;
- result and timestamps.

## 15. Validation ladder

```text
unit tests
→ deterministic fixtures
→ historical replay
→ paper simulation
→ shadow mode
→ controlled paper canary
→ extended paper validation
```

No strategy promotion occurs without reproducible evidence.

## 16. Target performance measurements

Measure, do not promise:

- market-event age;
- scout latency;
- fusion latency;
- risk-decision latency;
- order-processing latency;
- exit-response latency;
- fill rejection rate;
- stale-data rejection rate;
- duplicate prevention rate;
- realized/unrealized PnL accuracy;
- drawdown;
- win/loss distribution;
- profit factor;
- Sharpe/Sortino where statistically meaningful;
- slippage and fee impact.

Profitability is an outcome to evaluate in paper testing, not a guaranteed system property.

## 17. Implementation order

1. Normalize market-data quality and freshness.
2. Add typed scout-event contracts and expiry.
3. Add fusion scoring and conflict penalties.
4. Make risk decisions deterministic and fail-closed.
5. Add durable idempotency and atomic paper-order accounting.
6. Add position state machine and guardian.
7. Add internal protected-profit reserve.
8. Add replay, shadow mode, and parity tests.
9. Add latency and execution-quality metrics.
10. Extend frontend observability and operational controls.

See `BACKEND_CODEX_INSTRUCTIONS.md` for the implementation brief and `FRONTEND_STANDARD.md` for the dashboard standard.
