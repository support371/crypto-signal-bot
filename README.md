# Crypto Signal Bot V2

Crypto Signal Bot V2 is a React/Vite dashboard backed by a Cloudflare Worker, D1, R2, and KV. The current release is deliberately limited to paper trading and certification. It can observe public market data, calculate signals and risk evidence, rehearse paper orders, maintain a certification ledger, run backtests, and expose operational status.

It cannot place live exchange orders, move real funds, use mainnet execution, or withdraw assets. Those routes are blocked at the frontend and Worker boundaries.

## Current architecture

- **Frontend:** React, TypeScript, Vite, TanStack Query, Zustand; deployed on Vercel.
- **Certification API:** Cloudflare Worker using the `index_agent_context.ts` entrypoint.
- **State:** Cloudflare D1, R2, and KV for the deployed certification path.
- **Safety:** paper/testnet locks, Guardian state, risk approval, audit evidence, immutable certification records, and explicit HTTP 403 responses for live/withdrawal routes.
- **Candidate modules:** regulated-provider, recovery, accounting, and demo-transport code exists behind permanent capability locks and is not part of a live-money release.

## Public service

- Frontend: `https://crypto-signal-bot-indol.vercel.app`
- Dashboard: `https://crypto-signal-bot-indol.vercel.app/dashboard`
- Worker: `https://crypto-signal-bot-api.gr8r9bfzry.workers.dev`
- Release manifest: `https://crypto-signal-bot-indol.vercel.app/release.json`

Run `npm run verify:deployment` to verify the deployed release contract and the Worker safety locks.

## Local development

Requirements: Node.js 22 or later and npm 10 or later.

```bash
npm ci
cd worker && npm ci && cd ..
```

Create a local frontend environment without secrets:

```env
VITE_BACKEND_URL=http://127.0.0.1:8787
VITE_DEMO_MODE=true
VITE_PAPER_TRADING_MODE=true
```

Then run the Worker and frontend in separate terminals:

```bash
cd worker && npm run dev:local
npm run dev
```

## Required validation

```bash
npm run lint
npm run test:run
npm run build
npm run verify:ci-independence

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

The production deployment is manual-only. See [Production readiness](docs/production-readiness.md) and [Operator quick start](docs/OPERATOR_QUICKSTART.md).

## Safety boundary

- `/intent/paper` is the only dashboard order-rehearsal path.
- `/intent/live`, `/live/order`, and `/withdraw` must return HTTP 403.
- Public or stale market prices are display/certification inputs, never authority to move funds.
- A successful backtest or paper result does not guarantee future returns.

## License

Private — GEM Cybersecurity & Monitoring Assist
