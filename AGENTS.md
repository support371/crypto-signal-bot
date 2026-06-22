# Crypto Signal Bot — Repository Agent Instructions

This repository is governed by the canonical target architecture in [`docs/target-system/`](docs/target-system/README.md).

Every AI agent, engineer, reviewer, or automation tool working in this repository must read that folder before proposing or implementing changes.

## Non-negotiable operating rules

1. Preserve the existing product direction. Do not replace the architecture with a generic trading bot.
2. Keep execution in paper mode until explicit owner approval and verified readiness gates.
3. Never enable mainnet, live trading, or external withdrawals as part of routine development.
4. Distinguish external withdrawal from internal profit realization:
   - external withdrawal moves money out of the platform;
   - internal profit realization closes or reduces a position and returns proceeds to dashboard balance;
   - profit reserve keeps a configured share of realized profit inside the platform but unavailable to ordinary allocation.
5. Scout agents observe and report only. They cannot allocate capital or submit orders.
6. The signal-fusion engine ranks opportunities.
7. The risk engine is the sole authority for capital approval and position sizing.
8. The execution engine may act only on approved, fresh, idempotent instructions.
9. The position guardian manages exits, partial profit-taking, trailing protection, and emergency de-risking.
10. Financial mutations must be atomic, auditable, and reproducible.
11. Static or stale fallback prices are display-only and must never create fills.
12. No change is complete without tests, evidence, and an updated architecture or contract when behavior changes.

## Required reading order

1. [`docs/target-system/README.md`](docs/target-system/README.md)
2. [`docs/target-system/ARCHITECTURE.md`](docs/target-system/ARCHITECTURE.md)
3. [`docs/target-system/QUALITY_GATES.md`](docs/target-system/QUALITY_GATES.md)
4. [`docs/target-system/IMPLEMENTATION_ROADMAP.md`](docs/target-system/IMPLEMENTATION_ROADMAP.md)
5. [`docs/target-system/BACKEND_CODEX_BUILD_PROMPT.md`](docs/target-system/BACKEND_CODEX_BUILD_PROMPT.md)

## Change discipline

- Work on feature branches only.
- Read existing files and current SHAs before updates.
- Make the smallest architecture-compatible change.
- Do not expose secrets in code, logs, issues, PRs, or chat.
- Do not deploy or merge unless explicitly instructed.
- Keep Python and TypeScript formulas behaviorally consistent.
- Add or update tests for every financial, signal, risk, state-machine, and monitoring change.
- Record exact reasons for entry, rejection, reduction, exit, and profit reserve movement.

## Definition of success

The target is not unrestricted trading speed. The target is fast, low-latency detection and response with controlled risk, correct accounting, reliable profit realization, internal profit preservation, and complete observability.
