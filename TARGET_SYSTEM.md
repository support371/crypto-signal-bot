# Crypto Signal Bot — Canonical Target System

> **Source of truth for all agents, engineers, reviewers, and operators.**

The target architecture is documented in [`docs/target-architecture/`](docs/target-architecture/README.md).

## Non-negotiable operating model

```text
Market Data Gateway
→ Scout Agents
→ Signal Fusion Engine
→ Risk & Allocation Engine
→ Execution Engine
→ Position Guardian
→ Portfolio Ledger
→ Profit Reserve Engine
→ Audit & Monitoring
```

## Core meaning

- Scouts observe and report. They never spend funds.
- Signal fusion ranks opportunities and resolves conflicting evidence.
- The risk engine is the only capital-allocation authority.
- The execution engine acts only on approved paper-mode instructions.
- The position guardian manages partial exits, full exits, and profit protection.
- Realized proceeds return to the dashboard balance.
- A configurable share of realized profit may move to an internal protected reserve.
- External withdrawals remain blocked.

## Current safety mode

```text
TRADING_MODE=paper
EXCHANGE_MODE=paper
NETWORK=testnet
ALLOW_MAINNET=false
```

Do not enable live trading, mainnet, or external withdrawals from this target document.

## Required reading

1. [`docs/target-architecture/README.md`](docs/target-architecture/README.md)
2. [`docs/target-architecture/ARCHITECTURE_BLUEPRINT.md`](docs/target-architecture/ARCHITECTURE_BLUEPRINT.md)
3. [`docs/target-architecture/CODEX_BACKEND_BUILD_INSTRUCTION.md`](docs/target-architecture/CODEX_BACKEND_BUILD_INSTRUCTION.md)

Any implementation that changes this flow must explain the reason, preserve paper-mode safety, and include tests proving that the result still follows the same operational model.