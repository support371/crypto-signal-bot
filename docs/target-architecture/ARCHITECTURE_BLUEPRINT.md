# Architecture Blueprint — Paper-Mode Target

## Objective

Provide a clear, testable target for the backend and frontend without enabling live trading or changing the project’s core pattern.

## System layers

### 1. Market data gateway
Responsibilities:
- normalize symbols and timestamps;
- track source, sequence, and age;
- classify data as fresh, degraded, stale, or display-only;
- expose `execution_allowed` for paper simulation.

Required fields:
- `symbol`
- `price`
- `source`
- `exchange_timestamp`
- `received_at`
- `age_ms`
- `sequence`
- `quality_status`
- `execution_allowed`

### 2. Scout observers
Independent read-only observers:
- momentum;
- trend;
- volume;
- volatility;
- liquidity;
- reversal risk;
- correlation;
- market quality.

Each scout emits evidence with a unique event ID, confidence, expiry time, source timestamp, and model version. Scouts cannot create orders or change balances.

### 3. Signal fusion
Combines scout evidence into a candidate score. It must:
- require fresh evidence;
- decay old confidence;
- resolve disagreement;
- record positive and negative contributors;
- reject incomplete data.

### 4. Risk review
The sole simulated-capital authority. It evaluates:
- available paper cash;
- protected paper-profit reserve;
- open exposure;
- drawdown;
- volatility and liquidity;
- concentration and correlation;
- guardian state;
- market-data quality.

The risk review fails closed when required information is unavailable.

### 5. Paper execution
Required controls:
- idempotency key;
- duplicate prevention;
- capital reservation;
- fresh-price validation;
- order state machine;
- atomic portfolio mutation;
- audit record.

### 6. Position guardian
Tracks:
- entry price;
- current simulated price;
- high-water mark;
- cost basis;
- unrealized PnL;
- realized PnL;
- time held;
- risk deterioration.

Supported simulated actions:
- hold;
- reduce;
- partial take-profit;
- full close;
- cooldown.

### 7. Portfolio ledger
Canonical balances:
- `available_cash`
- `reserved_cash`
- `open_position_cost`
- `open_position_market_value`
- `realized_pnl`
- `unrealized_pnl`
- `protected_profit_reserve`
- `total_equity`

All monetary state changes require an immutable ledger entry.

### 8. Internal profit reserve
A configured portion of realized paper profit may move from available paper cash to a protected internal reserve. This is an accounting transfer inside the dashboard, not an external withdrawal.

### 9. Audit and monitoring
Every candidate, rejection, approval, simulated fill, partial exit, full exit, reserve movement, and guardian action must include:
- decision ID;
- event IDs;
- timestamp;
- strategy version;
- reason codes;
- before/after balances;
- related order and position IDs.

## State machine

```text
SCANNING
→ CANDIDATE
→ RISK_REVIEW
→ APPROVED | REJECTED
→ ENTRY_PENDING
→ OPEN
→ PROFIT_MANAGEMENT
→ PARTIALLY_CLOSED | EXIT_PENDING
→ CLOSED
→ PROFIT_RESERVED
→ COOLDOWN
→ SCANNING
```

Illegal transitions must be rejected and audited.

## Frontend standard

The frontend should expose a System Architecture page showing:
- the canonical flow;
- paper-mode safety status;
- responsibility boundaries;
- internal balance categories;
- delivery phases;
- implementation status labels: planned, in progress, verified.

## Acceptance criteria

1. Scouts cannot call execution routes.
2. Risk review is required before every simulated entry.
3. Duplicate requests create at most one portfolio mutation.
4. Stale or display-only data cannot create simulated fills.
5. Partial and full exits preserve cost basis and PnL math.
6. Protected reserve cannot be reused by normal allocation logic.
7. Every state change is auditable.
8. Python and TypeScript calculations have parity tests.
9. Backtests identify same-candle execution, fees, spread, slippage, and look-ahead assumptions.
10. Live trading, mainnet, and external withdrawals remain disabled.