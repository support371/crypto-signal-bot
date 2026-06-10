# Full-access agent setup

This project can be operated by a custom GPT or automation agent without committing secrets to the repository. Paste credentials only into the platform secret stores listed below.

## Required secret stores

### GPT Builder Actions

Configure Actions for these services and store tokens in the Action authentication settings:

- GitHub API: bearer token with access to `support371/crypto-signal-bot`
- Cloudflare API: bearer token with Workers, D1, R2, Durable Objects, routes, and account read/write access
- Vercel API: bearer token with project environment and deployment access

### GitHub Actions secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID` if the Vercel project belongs to a team

The deploy workflow consumes those secrets directly and never prints them.

### Cloudflare Worker secrets

Set runtime-only Worker secrets with Wrangler:

```bash
cd worker
wrangler secret put BACKEND_API_KEY --config ../wrangler.toml
```

Do not place Worker secrets under `[vars]` in `wrangler.toml`; `[vars]` is only for non-secret paper-mode configuration.

## What full access enables

Once the secrets above are installed, pushes to `main` or manual `workflow_dispatch` runs will:

1. Lint and build the frontend.
2. Type-check the Worker.
3. Verify paper-only safety invariants.
4. Dry-run the Wrangler bundle.
5. Deploy the Worker to Cloudflare.
6. Smoke-test all required Worker endpoints.
7. Update Vercel `VITE_BACKEND_URL` and request a production deployment.

## Paper-only guardrails

The agent must keep these invariants unchanged:

- `TRADING_MODE="paper"`
- `EXCHANGE_MODE="paper"`
- `ALLOW_MAINNET="false"`
- `POST /intent/live` returns HTTP 403
- `POST /withdraw` returns HTTP 403
- no real exchange execution keys are stored

Run this before any deployment:

```bash
cd worker
npm run verify:paper-safety
```
