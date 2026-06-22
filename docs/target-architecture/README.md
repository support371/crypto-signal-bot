# Target Architecture — Paper-Mode Reference

This folder is the canonical reference for agents, engineers, auditors, and reviewers working on crypto-signal-bot.

## Purpose

Define a testable paper-trading architecture that preserves the project’s intended flow while keeping live trading, mainnet execution, and external withdrawals disabled.

## Canonical flow

```text
Market Data Gateway
→ Data Quality Gate
→ Scout Observers
→ Signal Fusion
→ Risk Review
→ Paper Execution
→ Position Guardian
→ Portfolio Ledger
→ Internal Profit Reserve
→ Audit and Monitoring
```

## Role boundaries

- Scout observers collect evidence and publish observations.
- Signal fusion combines evidence and ranks paper-trade candidates.
- Risk review is the only stage allowed to approve simulated allocation.
- Paper execution applies idempotent simulated fills.
- Position guardian manages simulated partial exits and full exits.
- Portfolio ledger records available cash, reserved cash, positions, realized PnL, unrealized PnL, and total equity.
- Internal profit reserve tracks a protected portion of realized paper profit. It is not an external withdrawal.
- Audit and monitoring record every decision, rejection, and state change.

## Safety boundary

```text
TRADING_MODE=paper
EXCHANGE_MODE=paper
NETWORK=testnet
ALLOW_MAINNET=false
```

Live trading, mainnet execution, and external withdrawals remain outside this implementation target.

## Required documents

- `ARCHITECTURE_BLUEPRINT.md`
- `CODEX_BACKEND_BUILD_INSTRUCTION.md`
- `/TARGET_SYSTEM.md`

## Change-control rule

Any implementation must preserve the same stage order, keep paper-mode enforcement, reject stale or unverified data for simulated fills, prevent duplicate portfolio mutation, and include tests.