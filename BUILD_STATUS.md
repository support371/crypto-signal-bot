# Build Status

Status refreshed on 2026-08-25 from `main` baseline `2c9a890` plus the production auth and release hardening in this change.

## Verified locally

- Frontend scoped lint: passed.
- Frontend architecture typecheck: passed.
- Frontend tests: 49/49 passed.
- Frontend production build and performance budget: passed.
- Worker typecheck and provider-contract typecheck: passed.
- Worker contract tests: 26/26 passed.
- Worker foundation tests: 421/421 passed.
- Worker provider-contract tests: 179/179 passed.
- Legacy backend compatibility tests: 438/438 passed.
- Worker migrations: empty and upgrade paths passed through migration 030.
- Paper, live-candidate, regulated-foundation, certification, provider, recovery, accounting, and operator-read-only safety verifiers: passed.
- Frontend and Worker `npm audit --audit-level=low`: zero known vulnerabilities.
- Dependency refresh retained 49/49 frontend tests, 418/418 Worker foundation tests, 179/179 provider-contract tests, and 34/34 safety verifier scripts.
- Privileged Worker writes, agent memory, and arbitrary read-only D1 queries now fail closed when the server API-key binding is absent or invalid.
- Vercel uses the committed npm lockfile through `npm ci`.

## Release state

- Repository implementation: ready for a paper/certification deployment.
- Live trading: deliberately unavailable.
- Mainnet execution: deliberately unavailable.
- Withdrawals: deliberately unavailable.
- Real-funds release: not authorized and not represented as complete.

## Deployment drift found during the audit

The public Vercel site is reachable and exposes the expected release contract and dashboard. The public Cloudflare Worker remains behind the repository main branch: it does not expose `/v2/infrastructure/status`, its `/agent/context` response is the older contract, and it does not yet enforce the new privileged helper-route probes.

Use `npm run verify:deployment` after deployment. A release is not complete until that command passes against the public URLs.

## Owner-controlled items

- Cloudflare and Vercel credentials and billing remain external account responsibilities.
- Production deployment is manual through `.github/workflows/deploy.yml`.
- Authenticated operator identity is optional for public demo mode and requires owner-managed identity configuration.
- Any future live-money release requires a separate design, audit, approvals, and acceptance gates.
