# Worker / Python Boundary

> How the Cloudflare Worker (TypeScript) and Python backend (FastAPI) coexist.

## Two Runtimes, One Product

The system runs two independent server processes:

| Property | Worker (TypeScript) | Backend (Python) |
|----------|-------------------|------------------|
| Runtime | Cloudflare Workers (Hono) | FastAPI (uvicorn) |
| Entry point | `worker/src/index.ts` | `backend/app.py` |
| Database | D1 (SQLite at edge) | PostgreSQL (via SQLAlchemy) |
| Cache | D1 tables + R2 | Redis (optional) |
| State model | Stateless per-request | In-process module state + Redis |
| Deploy target | Cloudflare edge | Container / VPS |
| Auth | `X-API-Key` header | Supabase JWT + operator tokens |

## Route Ownership

### Worker Routes (Edge)

The Worker owns the **public-facing API** that the frontend SPA calls directly:

- `/healthz`, `/health`, `/api/health`, `/ready` — health checks
- `/runtime/status` — trading mode and runtime config
- `/market/*` — price feeds, snapshots (Coinbase primary, Binance fallback)
- `/signal/latest`, `/signal/history` — signal data from D1
- `/exchange/status`, `/exchange/circuit-breakers` — exchange connectivity
- `/orders`, `/order` (POST) — paper order placement
- `/orders`, `/orders/:id` (GET) — order history
- `/portfolio`, `/portfolio/*` — balance, positions, summary
- `/risk/decision` — risk gate evaluation
- `/guardian/status`, `/guardian/halt`, `/guardian/reset`, `/guardian/trigger`
- `/surge/*` — market surge detection
- `/earnings`, `/earnings/summary` — P&L
- `/audit` — audit log
- `/system/config` — runtime configuration
- `/intent/live`, `/withdraw`, `/live/order`, `/live/trade` — **permanently blocked** (403)

### Backend Routes (Python)

The Python backend owns **analytical, orchestration, and admin** endpoints:

- `/api/v1/audit/*` — detailed audit trails, decision traces, metrics
- `/api/v1/earnings/*` — earnings history with reset capability
- `/api/v1/analysis/*` — feature analysis, session simulation
- `/api/v1/decisions/*` — decision trace queries
- `/api/v1/portfolio/*` — portfolio persistence, reconciliation
- `/signal/predict`, `/signal/status` — prediction bot status
- `/health`, `/metrics` — backend-specific health
- WebSocket `/ws` — real-time update streaming

## Data Flow

```
                                 ┌──────────────────┐
                                 │   Frontend SPA    │
                                 │  (React + Vite)   │
                                 └────────┬─────────┘
                                          │
                          ┌───────────────┼───────────────┐
                          │               │               │
                   REST (edge)     REST (origin)    WebSocket
                          │               │               │
                 ┌────────▼────────┐ ┌────▼──────────┐   │
                 │  Worker (Hono)  │ │ Backend (ASGI)│◄──┘
                 │  Cloudflare     │ │ FastAPI        │
                 └────────┬────────┘ └────┬──────────┘
                          │               │
                   ┌──────▼──────┐  ┌─────▼──────┐  ┌───────┐
                   │  D1 (edge)  │  │ PostgreSQL │  │ Redis │
                   │  R2 (blobs) │  │            │  │       │
                   └─────────────┘  └────────────┘  └───────┘

External APIs: Coinbase, Binance (Worker fetches directly)
```

## Shared Concerns and Boundaries

### Market Data
- **Worker**: fetches prices from Coinbase/Binance with circuit breakers, caches in D1.
- **Backend**: `MarketDataService` fetches via CoinGecko, caches in-process and optionally Redis.
- These are **independent pipelines** — no cross-call between them.

### Signal Engine
- **Worker**: reads pre-computed signals from D1, computes freshness metadata.
- **Backend**: `prediction_bot/service.py` runs the actual signal computation loop using `logic/signals.py` and `logic/features.py`. Publishes results to Redis.
- The Worker does not call the Python signal engine. Signals reach D1 via the backend's scheduled writes or a future sync adapter.

### Guardian State
- **Worker**: manages guardian state in D1 (`guardian_state` table). Handles halt/reset/trigger.
- **Backend**: reads guardian status for its own risk gate decisions. The `guardian_bot/service.py` runs its own monitoring loop.
- Both maintain independent guardian views. A future reconciliation layer should unify them.

### Paper Orders
- **Worker**: places paper orders directly in D1 with idempotency keys.
- **Backend**: the coordinator generates intents that the execution router processes. Paper adapter writes to PostgreSQL.
- These are **separate order books**. The frontend currently targets the Worker for order placement.

### Audit
- **Worker**: writes audit events to D1 `audit_log` table.
- **Backend**: writes audit events to PostgreSQL via `audit/store.py`.
- Two separate audit stores. The `/audit` endpoint on each returns its own events.

## Safety Invariants

Both runtimes enforce paper-mode safety independently:

| Guard | Worker | Backend |
|-------|--------|---------|
| Live trading blocked | POST `/intent/live` returns 403 | `TRADING_MODE` checked at coordinator |
| Withdrawals blocked | POST `/withdraw` returns 403 | `withdrawal_manager.py` deleted entirely |
| Guardian kill switch | D1 `guardian_state.triggered` | In-process `guardian_bot` state |
| Mode announcement | `safeRuntime(env)` on every response | Paper mode in startup config |

## Frontend Configuration

The frontend's `VITE_BACKEND_URL` / `VITE_API_BASE_URL` controls which server it talks to:

- **Default (`/api`)**: Vercel rewrites to the Worker edge deployment.
- **Direct backend**: Set to the Python backend URL for analytical endpoints.
- **Local dev**: Worker at `:8787` (wrangler), Backend at `:8000` (uvicorn).

The frontend hooks (`usePortfolio`, `useGuardianStatus`, etc.) call whichever URL is configured. Most hooks hit the Worker for low-latency edge responses.

## Unification Roadmap

The dual-runtime architecture exists because the Worker was built first for edge performance, and the Python backend was added for analytical depth. To unify:

1. **Signal sync**: Backend prediction loop writes to both Redis and D1 (or a shared store).
2. **Single guardian**: One authoritative guardian state with the other runtime reading from it.
3. **Order reconciliation**: Cross-check D1 paper orders against PostgreSQL intents.
4. **Shared audit**: Either a single audit store or a merge-and-deduplicate view.
5. **API gateway**: Route frontend traffic through one entry point that proxies to the appropriate runtime.

Until then, both runtimes operate safely in paper mode with independent state.
