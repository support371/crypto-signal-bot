# Crypto Signal Bot — Agent Operating Contract

This file is the first required read for every AI agent, engineer, reviewer, or operator working in this repository.

## Authoritative target

The active infrastructure target is documented in:

- `docs/SAFE_FAST_PATH/README.md`
- `docs/SAFE_FAST_PATH/TARGET_ARCHITECTURE.md`
- `docs/SAFE_FAST_PATH/API_CONTRACT.md`
- `docs/SAFE_FAST_PATH/IMPLEMENTATION_PLAN.md`
- `docs/SAFE_FAST_PATH/BACKEND_CODEX_INSTRUCTIONS.md`

When implementation details conflict with these documents, treat the documents as the migration target and the existing production behavior as the compatibility boundary. Do not silently replace existing behavior.

## Non-negotiable safety rules

1. Paper trading remains the only executable mode until the owner explicitly authorizes a separately reviewed live-mode change.
2. Live trading, withdrawals, mainnet execution, and secret-bearing frontend variables remain blocked.
3. Static, cached, stale, sequence-broken, or synthetic prices are display-only and must never create a new executable entry.
4. Protective exits may use a degraded primary feed only when an independently healthy secondary feed confirms the executable price.
5. The risk engine is the sole authority for capital allocation.
6. A per-portfolio Durable Object is the sole writer for hot portfolio state.
7. D1 is a projection/history/read store; it is not the transactional owner of a fast paper fill.
8. Cloudflare Queues are for asynchronous side effects only. They must not sit between a valid market event and the portfolio commit.
9. Every executable intent requires a deterministic idempotency key and atomic duplicate rejection.
10. LLMs and deliberative agents remain outside the latency-critical execution path.

## Required development flow

1. Read the target documents above.
2. Inspect the existing implementation before editing.
3. Preserve current public API behavior unless the API contract explicitly introduces a versioned replacement.
4. Implement one migration phase at a time.
5. Add tests before declaring a phase complete.
6. Record measured evidence for latency, staleness, atomicity, and paper-safety gates.
7. Do not deploy or merge a phase whose acceptance gates are incomplete.

## Repository ownership map

- `worker/src/fast-path/`: normalized market events, integrity gates, incremental features, scouts, fusion, risk, and execution orchestration.
- `worker/src/durable-objects/`: per-portfolio state owner and atomic paper-ledger mutations.
- `worker/src/projections/`: D1 projection writers and read models.
- `worker/src/queues/`: audit, analytics, alerts, and training-data consumers.
- `worker/migrations/`: D1 projection schemas only.
- `src/features/infrastructure/`: frontend infrastructure/readiness presentation.
- `src/lib/infrastructureApi.ts`: read-only infrastructure API adapter.
- `docs/SAFE_FAST_PATH/`: authoritative architecture, contracts, rollout plan, and Codex build brief.

Some of these paths are migration targets and may not exist yet. Create them only in the phase that owns them.

## Base44 dev environment

The dev environment runs via `docker compose -f docker-compose.base44.yml up -d` and
exposes the Vite dev server on host port 3000. Three services are involved:

- **web** (node:22.12-alpine): Vite dev server on port 3000, bind-mounted to repo
  root. Proxies `/api` requests to the backend via `BACKEND_INTERNAL_URL`
  (defaults to `http://localhost:8000`, set to `http://backend:8000` in compose).
  Frontend runs in demo mode (`VITE_DEMO_MODE=true`) with `VITE_BACKEND_URL=/api`
  so all API calls go through the Vite proxy (single-origin).
- **backend** (python:3.11-slim): FastAPI/uvicorn with `--reload`, entry point
  `backend.render_entrypoint:app` on port 8000. Uses SQLite at
  `/app/backend/data/crypto_bot.db` (no external DB needed). `BACKEND_API_KEY` is
  intentionally unset — auth is disabled in dev so the demo-mode frontend can
  access all routes without Supabase credentials.
- **redis** (redis:7-alpine): Used for rate limiting, caching, and pub/sub.

To verify the app is working: curl `http://localhost:3000/` (frontend) and
`http://localhost:3000/api/health` (proxied backend health check).

Exchange API errors (Bitget 400, Binance geo-block) are expected in paper mode —
the backend handles them with circuit breakers and fallbacks.

## Definition of done

A change is complete only when:

- paper mode is still enforced;
- live and withdrawal endpoints remain blocked;
- no stale/static/synthetic entry can execute;
- duplicate intents cannot produce duplicate fills;
- balance, position, fill, realized PnL, and protected reserve mutate atomically;
- required tests pass;
- required metrics and traces are emitted;
- frontend readiness views report unavailable data as `not_reported` rather than inventing values;
- documentation and API contracts match the code.
