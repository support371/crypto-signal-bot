# Production Readiness — Paper Certification Release

## Production URLs

- Frontend: `https://crypto-signal-bot-indol.vercel.app`
- Dashboard: `https://crypto-signal-bot-indol.vercel.app/dashboard`
- Cloudflare Worker: `https://crypto-signal-bot-api.gr8r9bfzry.workers.dev`
- Frontend release manifest: `https://crypto-signal-bot-indol.vercel.app/release.json`

Render is not the production backend for this release.

## Required configuration

### Vercel

```env
VITE_BACKEND_URL=https://crypto-signal-bot-api.gr8r9bfzry.workers.dev
VITE_DEMO_MODE=true
VITE_PAPER_TRADING_MODE=true
```

Do not place exchange credentials, Worker API keys, or private secrets in `VITE_*` variables; Vite exposes them to browsers.

### Cloudflare Worker

The checked-in `wrangler.toml` binds D1, R2, and KV and enforces:

```env
TRADING_MODE=paper
EXCHANGE_MODE=paper
NETWORK=testnet
ALLOW_MAINNET=false
LIVE_TRADING_ENABLED=false
WITHDRAWALS_ENABLED=false
```

Production secrets, when required for privileged read-only operator functions, belong in Cloudflare secret bindings and must never be committed.

## Release procedure

1. Run every repository gate documented in the root `README.md`.
2. Confirm `git status` is clean and the intended commit is on `main`.
3. In GitHub Actions, run **Deploy to Cloudflare Workers (manual)** with `deploy_worker=true` and `update_vercel=true`.
4. Wait for the Worker smoke checks and Vercel production deployment to complete.
5. Run `npm run verify:deployment`.
6. Open `/dashboard` and `/infrastructure` and confirm the visible mode is certification/paper.

## Acceptance criteria

- `release.json` reports the expected paper-certification release contract.
- `/dashboard` serves the current Vite application.
- `/healthz` returns HTTP 200 with `status=ok`.
- `/runtime/status` reports paper, testnet, mainnet disabled, live trading disabled, and withdrawals disabled.
- `/v2/infrastructure/status` returns the v2 contract.
- `/agent/context` returns the rich certification context (HTTP 200 or 207 when a subcheck is degraded).
- `/intent/live`, `/live/order`, and `/withdraw` return HTTP 403.
- No browser bundle contains private credentials.
- The dashboard can create paper intents and display certification ledger results without calling a mutation-capable exchange client.

## Deployment-drift response

If `npm run verify:deployment` fails:

1. Do not treat the public site as the current release.
2. Compare the Vercel production deployment Git SHA with `main`.
3. Confirm the Cloudflare Worker entrypoint is `worker/src/index_agent_context.ts`.
4. Re-run the manual release workflow only after the validation job passes.
5. Keep real-money, mainnet, and withdrawal capabilities disabled while investigating.
