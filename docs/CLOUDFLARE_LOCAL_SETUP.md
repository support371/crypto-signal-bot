# Cloudflare Local Setup Runbook

This runbook explains how to run the Cloudflare Workers backend locally and how to prepare it for Cloudflare deployment.

## Important secret handling

Do not commit Cloudflare tokens, R2 access keys, or S3-compatible secrets to GitHub.

The screenshots used during setup exposed one-time token values. After the deployment is confirmed, rotate/revoke those tokens in Cloudflare and create new scoped tokens.

Use these credentials only as local environment variables on your own machine.

## Credential types

Cloudflare gives two different credential groups:

1. **Cloudflare API Token**
   - Used by Wrangler to create/deploy Workers, D1, R2, Durable Objects, and secrets.
   - Local env name: `CLOUDFLARE_API_TOKEN`.

2. **R2 S3-compatible credentials**
   - Used only by S3/R2 clients that upload/list/read objects directly.
   - Do not use these for Wrangler Worker deploys.

## Local environment file

Create a local-only file at the repo root:

```bash
cp .env.cloudflare.local.example .env.cloudflare.local
```

Edit `.env.cloudflare.local` and paste your values:

```bash
CLOUDFLARE_ACCOUNT_ID="your_account_id"
CLOUDFLARE_API_TOKEN="your_cloudflare_api_token"
```

Never commit `.env.cloudflare.local`.

## Install worker dependencies

```bash
cd worker
npm install
npm run build
npm run verify:paper-safety
```

## Confirm Cloudflare access

From the repo root:

```bash
set -a
source .env.cloudflare.local
set +a
cd worker
npm run cf:whoami
```

If Wrangler recognizes the account, continue.

## Create Cloudflare resources

From the repo root:

```bash
set -a
source .env.cloudflare.local
set +a

npx wrangler d1 create crypto-signal-bot-db --config wrangler.toml
npx wrangler r2 bucket create crypto-signal-bot-storage --config wrangler.toml
```

After `wrangler d1 create` runs, Cloudflare prints a real `database_id`.
Replace this placeholder in `wrangler.toml`:

```toml
database_id = "REPLACE_AFTER_D1_CREATE"
```

with the real D1 database ID.

## Run D1 migration

Local migration test:

```bash
cd worker
npm run migrate:local
```

Remote Cloudflare D1 migration:

```bash
cd worker
npm run migrate:remote
```

## Run Worker locally

```bash
cd worker
npm run dev
```

Default local URL:

```text
http://localhost:8787
```

Test locally:

```bash
curl http://localhost:8787/healthz
curl http://localhost:8787/runtime/status
curl http://localhost:8787/portfolio/summary
curl -X POST http://localhost:8787/intent/live
curl -X POST http://localhost:8787/withdraw
```

Expected safety behavior:

- `/healthz` returns `status: ok`
- `/runtime/status` returns `trading_mode: paper`
- `/portfolio/summary` returns `mode: paper`
- `/intent/live` returns `403`
- `/withdraw` returns `403`

## Deploy Worker

```bash
cd worker
npm run deploy
```

Expected backend URL:

```text
https://crypto-signal-bot-api.workers.dev
```

## Update Vercel frontend

Set this in Vercel:

```env
VITE_BACKEND_URL=https://crypto-signal-bot-api.workers.dev
VITE_DEMO_MODE=true
```

Then redeploy Vercel.

## Production safety rule

Keep these Cloudflare defaults unless you intentionally certify live trading:

```toml
TRADING_MODE = "paper"
EXCHANGE_MODE = "paper"
NETWORK = "testnet"
ALLOW_MAINNET = "false"
```

Live trading and withdrawals are intentionally blocked in the Worker backend.