# Production Readiness Audit — 2026-07-07

## Current classification

**NOT READY — PAPER MODE LOCKED FOR REMEDIATION**

This branch does not enable real-money execution. It converts the Render deployment boundary back to simulation-only mode and makes missing operator authentication fail closed.

## Critical findings corrected in this branch

### 1. Render configuration contained unsafe deployment defaults

The prior `render.yaml` selected a live exchange mode, mainnet networking, and enabled the mainnet gate. The production blueprint now declares:

- `TRADING_MODE=paper`
- `EXCHANGE_MODE=paper`
- `NETWORK=testnet`
- `ALLOW_MAINNET=false`
- CoinGecko as the public data-only adapter
- exact production CORS origin only

### 2. Render startup injected unsafe runtime values

The prior `render_start.py` injected live/mainnet defaults before starting the server. It now starts the hardened `backend.render_entrypoint:app` and defaults to paper/testnet-safe settings.

### 3. Missing operator authentication could fail open

The core application treats an empty operator key as authentication being disabled. The hosted Render entrypoint now installs a process-local, unpublished lock value when `BACKEND_API_KEY` is absent. Protected write routes therefore remain inaccessible until the deployment has a real operator secret.

### 4. Hosted readiness previously reported success without validating safety configuration

`/ready` now reports individual checks and returns HTTP 503 when any required paper-deployment condition is missing. `/trading-readiness` separately reports paper readiness and always reports live readiness as false on this branch.

### 5. Readiness could be masked by the lightweight health wrapper

The wrapper now handles only root and liveness probes. Readiness is delegated to the hardened application entrypoint.

## Automated regression coverage added

- configured operator keys are installed correctly
- missing or blank operator keys produce a deny-all deployment lock
- Render blueprint remains paper/testnet only
- mainnet remains disabled
- Render uses a public data-only adapter
- CORS contains no wildcard production origins
- Render startup uses the hardened entrypoint rather than a direct application fallback

## Remaining blockers

- Run the full backend test suite and frontend build through pull-request CI.
- Validate the deployed Render service after this branch is deployed.
- Verify database initialization, migration heads, event-log persistence, and restart recovery.
- Verify that every non-Render deployment path has equivalent fail-closed authentication.
- Audit all background services for any execution path that bypasses the hosted entrypoint boundary.
- Confirm Cloudflare Worker and Render responsibilities and select one canonical public API contract.
- Do not classify the project as production-ready until runtime evidence and persistence tests pass.

## Deployment boundary

The approved state for this branch is simulation-only paper operation. No deployment step in this branch should activate real-money execution or withdrawals.
