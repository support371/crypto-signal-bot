# Jules Trading Platform Salvage Review

Reviewed branches:

- `feat/build-trading-platform-14047153187029945517`
- `jules-backend-setup-11315302861801406339`

Decision: do not port raw code from either branch into `main`.

## Findings

Both branches contain early standalone build/scaffold work. They are not safe bulk-merge candidates because they include tracked local artifacts such as `.env`, `bun.lockb`, and in one branch `server.log`.

The backend in `feat/build-trading-platform-14047153187029945517` is an older scaffold with a much smaller FastAPI surface than current `main`.

The backend in `jules-backend-setup-11315302861801406339` contains useful domain concepts, including:

- contracts and schemas
- deterministic market posture
- deterministic intent sizing
- governance gates
- reconciliation checks
- OMS / execution / portfolio module boundaries

These concepts are valuable as future design references, but their implementation is not directly compatible with the current production backend. Current `main` already has stronger runtime controls, including guardian service coverage, expanded exchange and market-data handling, runtime configuration, dashboard panels, tests, and release tooling.

## Salvageable concepts for future work

Convert these into future issues or PRs only after explicit design alignment with current `main` contracts:

1. Deterministic intent-sizing tests using current `backend.models.execution_intent` and risk engine contracts.
2. Reconciliation-drift monitoring wired into the existing guardian service.
3. Strategy-level and venue-level kill switches integrated with current kill-switch routes and guardian state.
4. Portfolio exposure checks aligned with current portfolio and earnings services.

## Non-salvage items

Do not port:

- tracked `.env` files
- local logs
- legacy root app structure
- legacy contract schemas as-is
- obsolete backend scaffold
- lockfiles from a different package-management path

## Outcome

- Code port: none
- Documentation added: this review
- Recommended branch action after this review lands: keep only if historical reference is required; otherwise delete/archive these legacy build branches.
