# Crypto Signal Bot Cloudflare/Vercel Deploy Handoff

The current release uses the paper/certification Cloudflare Worker at `https://crypto-signal-bot-api.analyzer-d94.workers.dev` with Cloudflare D1, R2, KV Agent Memory, cron triggers, and a Vercel-hosted frontend. The canonical frontend is `https://crypto-signal-bot-indol.vercel.app`.

The execution hierarchy is BTCC primary and Bitget secondary. Coinbase is public read-only market data only. This handoff does not authorize live exchange mutation, real-fund dispatch, mainnet execution, or withdrawals.

## Security note

Do not commit Cloudflare, GitHub, Vercel, Supabase, R2, operator, or exchange credentials. If any credential has been pasted into chat, an issue, a PR, a log, or a generated file, treat it as compromised and rotate it before deployment.

## Paper-only invariants

The release must preserve:

- `TRADING_MODE="paper"`
- `EXCHANGE_MODE="paper"`
- `NETWORK="testnet"`
- `ALLOW_MAINNET="false"`
- `MARKET_DATA_PUBLIC_EXCHANGE="coinbase"`
- BTCC primary / Bitget secondary execution metadata
- `POST /intent/live` returns HTTP 403
- `POST /live/order` returns HTTP 403
- `POST /withdraw` returns HTTP 403
- provider mutation remains false
- real funds remain false

Run the static safety checks before deployment:

```bash
npm ci
npm run build
npm run verify:paper-worker-release
```

## Deployment sequence

1. Export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through a secret store or protected shell environment. Do not hard-code either value into the repository.
2. Confirm that `wrangler.toml` points to the intended migrated account resources, including the D1 database, R2 bucket, and `AGENT_MEMORY` KV namespace.
3. Run the release gate:
   ```bash
   npm run verify:paper-worker-release
   ```
4. Deploy through the guarded repository script:
   ```bash
   bash scripts/deploy-worker.sh
   ```
   The script refuses to run without owner-managed Cloudflare credentials, uses the current migrated Worker URL, applies the paper-release checks, and performs runtime smoke verification.
5. Configure Worker-side identity-provider values as Cloudflare secrets/variables only when the intended production identity project has been selected:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY` (or the compatible anon key)
   `BACKEND_API_KEY` remains a server-side secret and must never be exposed as `VITE_*`.
6. Configure Vercel browser-safe authentication variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_DEMO_MODE=false`
7. Set Vercel backend variables to the migrated Worker:
   - `VITE_BACKEND_URL=https://crypto-signal-bot-api.analyzer-d94.workers.dev`
   - `VITE_CRYPTOCORE_API_BASE=https://crypto-signal-bot-api.analyzer-d94.workers.dev`
8. Trigger one deliberate production Vercel deployment after the Worker and identity configuration are ready. Avoid repeated deployment churn when the free deployment quota is rate-limited.
9. Promote the accepted deployment to `crypto-signal-bot-indol.vercel.app` and verify `/release.json`, `/status`, `/api/release-attestation`, `/auth`, `/account`, and `/admin` from the canonical domain.
10. Bootstrap the first global `RELEASE_ADMIN` only once. The bootstrap path requires both a valid authenticated user session and the server operator key, and it closes after an active global `RELEASE_ADMIN` exists.

## Post-deploy checks

```bash
WORKER=https://crypto-signal-bot-api.analyzer-d94.workers.dev
curl "$WORKER/healthz"
curl "$WORKER/runtime/status"
curl "$WORKER/v2/infrastructure/status"
curl "$WORKER/agent/context"
curl "$WORKER/guardian/status"
curl "$WORKER/portfolio/summary"
curl "$WORKER/market/feed/status"
curl "$WORKER/exchange/circuit-breakers"
curl -i -X POST "$WORKER/intent/live"
curl -i -X POST "$WORKER/live/order"
curl -i -X POST "$WORKER/withdraw"
```

The three disabled financial-action probes above must return HTTP 403. Privileged helper endpoints such as `/d1/query/readonly` and `/agent/memory/{key}` must return HTTP 401 without the operator key.

Finally run:

```bash
npm run verify:deployment
```

Do not declare the release complete if the canonical Vercel alias is serving an older deployment, the identity provider is unconfigured, or any paper/testnet invariant fails.
