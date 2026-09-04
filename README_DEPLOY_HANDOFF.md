# Crypto Signal Bot Cloudflare/Vercel Deploy Handoff

This repo is configured for a paper-only Cloudflare Workers backend at `https://crypto-signal-bot-api.gr8r9bfzry.workers.dev` with Cloudflare D1, R2, KV, cron triggers, and a Vercel-hosted frontend. The safe-fast-path Durable Object and Queue authority remain future migration phases and are not represented as active production bindings.

## Security note

Do not commit Cloudflare, GitHub, Vercel, R2, or exchange credentials. If any credential has been pasted into chat, an issue, a PR, a log, or a generated file, treat it as compromised and rotate it before deployment.

## Paper-only invariants

The Worker configuration enforces these defaults:

- `TRADING_MODE="paper"`
- `EXCHANGE_MODE="paper"`
- `ALLOW_MAINNET="false"`
- `MARKET_DATA_PUBLIC_EXCHANGE="coinbase"`
- `POST /intent/live` returns HTTP 403
- `POST /withdraw` returns HTTP 403

Run the local static safety check before deployment:

```bash
cd worker
npm run verify:paper-safety
```

## Deployment sequence

1. Export Cloudflare credentials in your terminal or CI secret store without printing them.
2. Confirm the configured D1 database exists (create it only for a new Cloudflare account):
   ```bash
   wrangler d1 create crypto-signal-bot-db
   ```
3. Confirm that the returned database id matches the committed `database_id` in `wrangler.toml`; do not rewrite a valid production binding.
4. Confirm the R2 bucket exists (create it only when absent):
   ```bash
   wrangler r2 bucket create crypto-signal-bot-storage
   ```
5. Install and type-check the Worker:
   ```bash
   cd worker
   npm install
   npm run build
   npm run verify:paper-safety
   ```
6. Run the D1 migration:
   ```bash
   npm run migrate
   ```
7. Set required Worker secrets without echoing values into shell history:
   ```bash
   wrangler secret put BACKEND_API_KEY --config ../wrangler.toml
   ```
8. Deploy:
   ```bash
   npm run deploy
   ```
9. Update Vercel so both `VITE_BACKEND_URL` and `VITE_API_BASE_URL` equal `https://crypto-signal-bot-api.gr8r9bfzry.workers.dev`, then trigger a production redeploy only after Worker smoke checks pass.
10. Add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, and optional `VERCEL_TEAM_ID` values to GitHub Actions secrets.

## Post-deploy checks

```bash
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/healthz
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/runtime/status
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/surge/status
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/guardian/status
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/portfolio/summary
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/market/feed/status
curl https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/exchange/circuit-breakers
curl -i -X POST https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/intent/live
curl -i -X POST https://crypto-signal-bot-api.gr8r9bfzry.workers.dev/withdraw
```
