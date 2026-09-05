#!/usr/bin/env bash
set -euo pipefail

# Guarded paper/certification Worker deployment.
# The Cloudflare account is intentionally supplied by the deployment environment;
# this script never hard-codes or auto-creates resources in a historical account.

WORKER_URL="https://crypto-signal-bot-api.analyzer-d94.workers.dev"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

export TRADING_MODE=paper
export EXCHANGE_MODE=paper
export NETWORK=testnet
export ALLOW_MAINNET=false
export LIVE_TRADING_ENABLED=false
export WITHDRAWALS_ENABLED=false

echo "== Crypto Signal Bot guarded Worker release =="
echo "Target: $WORKER_URL"
echo "Account: $CLOUDFLARE_ACCOUNT_ID"

echo "[1/4] Validate current account credentials"
npm --prefix worker exec -- wrangler whoami --config ../wrangler.toml >/dev/null

echo "[2/4] Run complete paper Worker release gates"
npm run verify:paper-worker-release

echo "[3/4] Deploy checked wrangler.toml to the supplied account"
(
  cd worker
  ./node_modules/.bin/wrangler deploy --config ../wrangler.toml
)

echo "[4/4] Smoke the migrated Worker"
npm --prefix worker run smoke -- "$WORKER_URL"

echo "Deployment complete: $WORKER_URL"
