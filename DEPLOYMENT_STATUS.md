# Deployment Status — CryptoOps

## Current Active Architecture

- Frontend: https://crypto-signal-bot-indol.vercel.app
- Backend Worker: https://crypto-signal-bot-api.gr8r9bfzry.workers.dev
- Database: Cloudflare D1 (`crypto-signal-bot-db`)
- Storage: Cloudflare R2 (`crypto-signal-bot-storage`)

## Paper Safety

- TRADING_MODE=paper
- EXCHANGE_MODE=paper
- ALLOW_MAINNET=false
- NETWORK=testnet
- `/intent/live` must return HTTP 403
- `/withdraw` must return HTTP 403

## Release Lane

Prefer `.github/workflows/self-hosted-release.yml` for guarded releases. It is manual, paper-safe, and verifies live/withdrawal blocks after Worker checks.

Avoid legacy Render release paths. Render keepalive is disabled after migration to Cloudflare Workers.

## Frontend Backend URL

Vercel should point `VITE_BACKEND_URL` to:

```text
https://crypto-signal-bot-api.gr8r9bfzry.workers.dev
```

Do not store real secrets in VITE-prefixed variables because Vite exposes them to the browser bundle.
