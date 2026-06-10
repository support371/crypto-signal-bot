# Crypto Signal Bot Cloudflare/Vercel Deploy Handoff

This repo is configured for a paper-only Cloudflare Workers backend at `https://crypto-signal-bot-api.workers.dev` with Cloudflare D1, R2, Durable Objects, cron triggers, and a Vercel-hosted frontend.

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

1. Export fresh, rotated Cloudflare credentials in your terminal or CI secret store.
2. Create the D1 database:
   ```bash
   wrangler d1 create crypto-signal-bot-db
   ```
3. Replace `REPLACE_AFTER_D1_CREATE` in `wrangler.toml` with the returned database id.
4. Create the R2 bucket:
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
9. Update Vercel so `VITE_BACKEND_URL=https://crypto-signal-bot-api.workers.dev`, then trigger a production redeploy.
10. Add rotated `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` values to GitHub Actions secrets.

## Post-deploy checks

```bash
curl https://crypto-signal-bot-api.workers.dev/healthz
curl https://crypto-signal-bot-api.workers.dev/runtime/status
curl https://crypto-signal-bot-api.workers.dev/surge/status
curl https://crypto-signal-bot-api.workers.dev/guardian/status
curl https://crypto-signal-bot-api.workers.dev/portfolio/summary
curl https://crypto-signal-bot-api.workers.dev/market/feed/status
curl https://crypto-signal-bot-api.workers.dev/exchange/circuit-breakers
curl -i -X POST https://crypto-signal-bot-api.workers.dev/intent/live
curl -i -X POST https://crypto-signal-bot-api.workers.dev/withdraw
```
