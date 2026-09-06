# Crypto Signal Bot V2

Crypto Signal Bot V2 is a React/Vite application backed by a Cloudflare Worker, D1, R2 and KV. The current production contract is deliberately **paper/certification/testnet-only**.

It can observe public market data, calculate signals and risk evidence, rehearse paper orders, maintain certification/audit evidence, run backtests, expose operational status, and manage authenticated users and scoped application access.

It **cannot** place real exchange orders, move real funds, use mainnet execution, enable provider mutation or withdraw assets. Those capabilities remain fail-closed at frontend, Worker and release-contract boundaries.

## Canonical production

- Frontend: `https://crypto-signal-bot-indol.vercel.app`
- Dashboard: `https://crypto-signal-bot-indol.vercel.app/dashboard`
- Account: `https://crypto-signal-bot-indol.vercel.app/account`
- Admin: `https://crypto-signal-bot-indol.vercel.app/admin`
- Production status: `https://crypto-signal-bot-indol.vercel.app/status`
- Worker: `https://crypto-signal-bot-api.analyzer-d94.workers.dev`
- Release manifest: `https://crypto-signal-bot-indol.vercel.app/release.json`
- Release attestation: `https://crypto-signal-bot-indol.vercel.app/api/release-attestation`

The former `crypto-signal-bot-api.gr8r9bfzry.workers.dev` hostname is a legacy deployment identity and must not be used as an active release target.

## Exchange hierarchy

- **Primary execution exchange:** BTCC
- **Secondary execution exchange:** Bitget
- **Public market-data source:** Coinbase

The execution hierarchy does not imply live trading is enabled. The current release remains paper/testnet-only.

## Usage-management architecture

The production management plane reuses the existing Worker authorization vocabulary instead of introducing a conflicting role system.

Roles include:

- `VIEWER`
- `TRADER`
- `RISK_OPERATOR`
- `RISK_ADMIN`
- `WITHDRAWAL_REQUESTER`
- `WITHDRAWAL_APPROVER`
- `AUDITOR`
- `RELEASE_ADMIN`

Roles are scoped by `GLOBAL`, `EXCHANGE`, or `ACCOUNT`. Expired and revoked grants are ignored. Administrative browser visibility is never authoritative: the Worker validates the authenticated bearer session and loads current role grants from D1.

The management API lives under `/v1/management` and provides:

- authenticated account/profile lifecycle;
- user directory and suspension/reactivation controls;
- scoped role grant/revocation with separation of duties;
- immutable management audit events;
- aggregated usage evidence;
- management-plane rate limiting;
- session-security event evidence;
- system/safety visibility;
- a server-key + authenticated-identity bootstrap path for the first `RELEASE_ADMIN`.

The canonical production domain never injects the synthetic demo identity. Preview/development deployments can deliberately enable demo mode, but demo authority is always limited to non-admin certification access.

## Authentication

Frontend production authentication uses the configured Supabase-compatible identity provider:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_DEMO_MODE=false
```

The Worker validates bearer sessions against the same provider using Worker-side variables:

```env
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

`BACKEND_API_KEY` remains a Worker/server secret. Never put it, exchange secrets, Cloudflare credentials, service-role keys, access tokens or refresh tokens in any `VITE_*` variable.

## Current architecture

- **Frontend:** React 18, TypeScript, Vite, TanStack Query, Tailwind/shadcn; deployed on Vercel.
- **Certification API:** Cloudflare Worker using `worker/src/index_agent_context.ts`.
- **State:** Cloudflare D1, R2 and KV/`AGENT_MEMORY`.
- **Identity:** external Supabase-compatible auth session; server-authoritative management authorization in the Worker.
- **Safety:** paper/testnet locks, Guardian state, scoped authorization, separation of duties, audit evidence, immutable certification records and explicit HTTP 403 responses for disabled live/withdrawal routes.
- **Candidate modules:** regulated-provider, recovery, accounting and demo-transport code remains behind capability locks and is not a real-money release.

## Local development

Requirements: Node.js 22.12 or later and npm 10 or later.

```bash
npm ci
cd worker && npm ci && cd ..
```

For deliberate local/demo development:

```env
VITE_BACKEND_URL=http://127.0.0.1:8787
VITE_DEMO_MODE=true
```

Then run the Worker and frontend in separate terminals:

```bash
cd worker && npm run dev:local
npm run dev
```

## Required validation

Root gates:

```bash
npm run lint
npm run typecheck
npm run typecheck:architecture
npm run test:run
npm run verify:usage-management
npm run build
npm run verify:ci-independence
```

Worker gates:

```bash
cd worker
npm run build
npm run test:live-foundation
npm run test:provider-contracts
npm run verify:paper-safety
npm run verify:live-candidate-safety
npm run verify:regulated-foundation-safety
npm run verify:certification-safety
npm run verify:migrations
```

For the deployed release:

```bash
npm run verify:deployment
```

The production Worker deployment is manual/controlled and must target the current Cloudflare account through `wrangler.toml`; deployment tooling no longer hard-codes the historical Cloudflare account.

## Safety boundary

- `/intent/paper` is the dashboard paper-order rehearsal path.
- `/intent/live`, `/live/order`, and `/withdraw` must remain HTTP 403.
- Public/stale market prices are display/certification inputs, never authority to move funds.
- Role assignment never overrides paper mode, testnet, disabled mainnet, disabled withdrawals or provider-mutation locks.
- A successful backtest or paper result does not guarantee future returns.

See `docs/production-readiness.md`, `docs/USAGE_MANAGEMENT.md`, `docs/ACCESS_CONTROL.md`, and `docs/OPERATOR_QUICKSTART.md` for operations.

## License

Private — GEM Cybersecurity & Monitoring Assist
