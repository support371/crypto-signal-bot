# Crypto Signal Bot — Agent Entry Point

All agents, engineers, reviewers, and auditors working in this repository must begin here.

## Source of truth

The target operating model is maintained in:

- `docs/target-architecture/README.md`
- `docs/target-architecture/FRONTEND_STANDARD.md`
- `docs/target-architecture/BACKEND_CODEX_INSTRUCTIONS.md`

These documents describe the intended architecture and must be read before changing trading, signal, portfolio, risk, monitoring, or frontend behavior.

## Non-negotiable boundaries

- Current execution remains paper/simulation only.
- `ALLOW_MAINNET` must remain false.
- External withdrawals remain blocked.
- Internal profit realization means closing or reducing a position and returning proceeds to dashboard cash or an internal protected-profit reserve.
- Scout agents may observe and report only. They may never allocate capital or submit orders.
- The risk engine is the sole authority for approving capital allocation.
- No system component may claim guaranteed profit or certain prediction of future market movement.
- Every financial mutation must be idempotent, auditable, and protected against stale market data.
- Never commit secrets, tokens, exchange credentials, or wallet material.

## Required change discipline

1. Read the target architecture documents.
2. Inspect current implementation before proposing changes.
3. Work on a feature branch, never directly on `main`.
4. Preserve paper-mode safety.
5. Add or update tests for every financial calculation or state transition.
6. Record exact files, routes, functions, assumptions, and validation results.
7. Do not deploy or merge unless separately authorized.

## Frontend architecture showcase

The application includes a target-system page at `/system-architecture`. It is a visible summary for experts and agents; the detailed repository documents remain authoritative.
