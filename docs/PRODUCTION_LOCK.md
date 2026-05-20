# Crypto Risk Agent Production Lock

## Status

Production finalization lane is active on branch `agent/production-lock-finalization`.

This document is the release-control artifact required by the `Production Lock` workflow before production merge.

## Source of truth

- Repository: `support371/crypto-signal-bot`
- Production branch: `main`
- Release branch: `agent/production-lock-finalization`
- Runtime identity: Crypto Risk Agent trading control center

## Locked production controls

The current production baseline includes the following merged controls:

1. Guardian global kill switch.
2. Guardian strategy-level kill switches.
3. Guardian venue-level kill switches.
4. Execution-path scope gating before risk evaluation and order placement.
5. Portfolio-level exposure cap enforcement.
6. Reconciliation drift tracking and halt trigger.
7. Dashboard visibility for scoped Guardian controls.
8. Supabase environment compatibility for Vite and Vercel-style public variables.
9. Frontend production build contract through `/api` routing.
10. Backend import, audit, and stabilization test contract.

## Production gate

The `.github/workflows/production-lock.yml` workflow is the required production-readiness gate for this branch. It validates:

- no committed runtime environment files or private key files;
- Node 22 frontend dependency install;
- frontend lint;
- frontend production build with `/api` backend routing;
- built artifact presence;
- Python 3.11 backend dependency install;
- backend application import surface;
- structural repository audit;
- stabilization pytest contract;
- this production lock artifact.

## Runtime configuration contract

Runtime values must remain in platform-managed environment settings only.

Frontend public configuration:

- `VITE_BACKEND_URL` or `VITE_BACKEND_BASE_URL`
- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, or `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Backend and exchange configuration must stay in the deployment provider secret store, not in repository files.

## Release decision

Production is allowed to proceed only after the production-lock workflow passes on the release branch or pull request.

If the workflow fails, production is not finalized. Fix the failing control, rerun the gate, and merge only after a clean pass.

## Rollback posture

Rollback remains branch-based and deployment-provider based:

1. revert the production merge if the code change is defective;
2. redeploy the last known good production deployment if the runtime environment fails;
3. keep Guardian kill switch available for immediate trading halt behavior.
