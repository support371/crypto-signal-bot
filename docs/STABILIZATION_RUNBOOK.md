# Production Runtime Stabilization Runbook

## Scope

This runbook tracks the `chatgpt/stabilize-production-runtime` lane. The goal is to validate the current production path, reduce CI ambiguity, and prepare selective branch salvage without bulk-merging stale work.

## Current source of truth

- Repository: `support371/crypto-signal-bot`
- Default branch: `main`
- Stabilization branch: `chatgpt/stabilize-production-runtime`
- Vercel project: `crypto-signal-bot`
- Production branch: `main`
- Latest observed production deployment: `READY` / `PROMOTED`
- Frontend framework: Vite
- Backend framework: FastAPI

## Immediate controls

1. Keep production source-of-truth on `main` until this stabilization branch passes CI.
2. Do not bulk-merge feature or hardening branches.
3. Cherry-pick only isolated commits with clear runtime or security value.
4. Treat live trading as disabled unless `TRADING_MODE=live`, valid exchange credentials, and explicit `ALLOW_MAINNET=true` are all intentionally configured.

## CI baseline

The stabilization branch splits CircleCI into two independent jobs:

- `frontend-build`
  - installs frontend dependencies with `npm ci`
  - runs `npm run lint`
  - builds Vite with `/api` backend routing

- `backend-test-audit`
  - installs backend dependencies from `backend/requirements.txt`
  - runs `python -m pytest backend/tests tests -q`
  - runs `python scripts/repo_audit.py`

## Branch salvage priority

Inspect these branches first and cherry-pick only proven-safe deltas:

| Branch | Initial signal | Action |
|---|---|---|
| `chatgpt/branch-salvage-production-hardening` | Adds branch salvage workflow/tests | Review for repo hygiene only |
| `chatgpt/ops-security-frontend-hardening` | Frontend URL normalization and security runbook | Review for low-risk frontend hardening |
| `chatgpt/proxy-security-hardening` | Nginx/proxy security posture | Review only if proxy path is active |
| `feat/backend-market-state-health` | Backend-owned market state and health | Review for runtime health endpoints |
| `chatgpt/render-config-fix` | Backend container startup / Render fixes | Review only if Render remains target |
| `chatgpt/db-audit-core` | Event log storage and tests | Review for audit persistence only |

## Verification checklist

Run locally or in CI:

```bash
npm ci
npm run lint
npm run build
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests tests -q
python scripts/repo_audit.py
```

Runtime checks:

- production frontend loads
- frontend API base resolves to `/api`
- backend health endpoint responds
- write endpoints reject missing/invalid `BACKEND_API_KEY` when configured
- paper/testnet mode remains default-safe
- mainnet trading requires explicit `ALLOW_MAINNET=true`
- CORS allows production frontend and rejects unexpected origins

## Merge criteria

Merge the stabilization PR only when:

- both CircleCI jobs pass
- no production deployment regression is observed
- no secrets are introduced
- no branch-salvage changes are merged without isolated review
