# Architecture Audit

> Full repository audit — November 2026. Supersedes prior audit from PR #75.

## System Overview

Crypto-signal-bot is a cryptocurrency trading platform operating in **paper-only mode**. It consists of three layers:

| Layer | Stack | Host | Purpose |
|-------|-------|------|---------|
| **Frontend** | React 18 + TypeScript + Vite + shadcn-ui + TanStack Query | Vercel | Trading dashboard SPA |
| **Python Backend** | FastAPI + SQLAlchemy async + uvicorn | Render | Signal engine, risk, portfolio, API |
| **Worker Backend** | Cloudflare Workers + D1 + R2 + KV + Durable Objects | Cloudflare | Rate limiting, paper trading, cron jobs, Bitget integration |

```
Frontend (Vercel)             Python Backend (Render)         Worker (Cloudflare)
┌──────────────────┐          ┌────────────────────┐          ┌─────────────────────┐
│ React + Vite SPA │───API───▶│ FastAPI (uvicorn)   │          │ Workers + D1 + R2   │
│ shadcn/Radix UI  │◀──WS────│ ├── engine/          │          │ ├── rate limiting    │
│ TanStack Query   │          │ ├── logic/           │          │ ├── paper trading    │
│ Recharts         │          │ ├── services/        │          │ ├── cron triggers    │
│ Supabase Auth    │          │ ├── adapters/        │          │ ├── Durable Objects  │
└──────────────────┘          │ ├── db/ (SQLAlchemy) │          │ └── Bitget V3 client │
                              │ └── routes/          │          └─────────────────────┘
                              └────────────────────┘
```

**Auth**: Supabase (lazy-loaded). Demo mode when unconfigured. Browser-level blocks on live/withdraw/mainnet paths.

**Safety invariants**: `TRADING_MODE=paper`, `ALLOW_MAINNET=false`, `executionAllowed=false as const`, mainnet gate enforcement in engine.

---

## Frontend Architecture

### Routing (AppCore.tsx — 17 routes, 4 access tiers)

| Tier | Routes | Auth |
|------|--------|------|
| Public | `/`, `/auth`, `/auth/repair`, `/reset-password`, `/waitlist`, `/status`, `/demo` | None |
| Dashboard | `/dashboard` | Lenient (demo OK) |
| Protected | `/backtest`, `/portfolio`, `/settings`, `/integrations`, `/infrastructure`, `/operator-readiness` | Role-required |
| Admin | `/admin` + 6 sub-paths | Admin role |

### Component Inventory

| Category | Count | Location |
|----------|-------|----------|
| UI primitives (shadcn) | 43 | `src/components/ui/` |
| Dashboard panels | 17 | `src/components/dashboard/` |
| Shared components | 13 | `src/components/` (top-level) |
| Pages | 22 | `src/pages/` |
| Hooks | 19 | `src/hooks/` |

### State Management

- **AuthContext** — Supabase auth with demo mode fallback, bootstrap timeout (8s), fail-closed
- **QueryClientProvider** — TanStack React Query for all server state
- **AuthBannerContext** — banner display state
- **Local state** — `Index.tsx` (709 lines) uses extensive useState/useRef

### API Layer

Two parallel clients exist:
- **`backendRuntime.ts`** (aliased as `@/lib/backend`) — primary client, 18 consumers. Has Supabase auth token injection, browser-safe path blocking, timeout, error handling.
- **`api.ts`** — secondary client, 3 consumers. No auth token injection. **Should be consolidated.**

**`env.ts`** resolves backend URL: DEV → `localhost:8000`, PROD → Cloudflare Worker URL. `paperTradingMode: true` hardcoded.

### Unreachable Pages (5 files, no routes)

`Audit.tsx`, `Positions.tsx`, `Guardian.tsx`, `Health.tsx` — all stubs ("coming soon"). `PrivacyPolicy.tsx` — has content but unrouted.

### Frontend Verdict

**Sound overall.** The dashboard is feature-rich (price charts, signals, guardian, portfolio, audit trail, earnings, risk gauge, surge scanner, monitoring, command console, AI insights, system metrics). Auth is production-grade. shadcn-ui component library is comprehensive. Key gaps: dual API clients, stub pages, `Index.tsx` state sprawl.

---

## Backend Architecture

### Module Layout (Current vs Target)

| CLAUDE.md Target | Current Location | Status |
|-----------------|-----------------|--------|
| `config/` | `config/` (loader, settings, runtime, mode_control) | **Sound** — Pydantic Settings + YAML + typed sub-configs |
| `core/` | `logic/` (~18 files, grab-bag) | **Needs split** — rename/split into core + policy |
| `engine/` | `engine/` (coordinator, routing, risk_rules, pnl, state_machine) | **Sound** — well-structured |
| `policy/` | Absent; lives in `logic/risk.py`, `logic/signals.py`, `logic/strategies.py` | **Missing** — extract from logic/ |
| `risk/` | Split: `logic/risk.py` + `engine/risk_rules.py` + `services/risk_gate/` | **Needs consolidation** — 3 locations |
| `reconciliation/` | `services/reconciliation/service.py` | **Sound** — drift detection, interval loop |
| `adapters/` | `adapters/` (exchanges + brokers) + `logic/exchange_adapter.py` | **Sound** but PaperAdapter misplaced |
| `audit/` | `services/audit/service.py` + `logic/audit_store.py` | **Split** — consolidate |
| `api/` | `routes/` (16 files) + inline in `app.py` (~40 endpoints) | **Needs refactor** — monolith app.py |
| `tests/` | `tests/` (29 files, 441 passing) | **Sound** |

### API Endpoints (~100+)

**`app.py`** (~1,400 lines) defines ~40 endpoints inline. 16 route modules add ~60 more. Duplicate endpoint paths exist across modules (e.g., guardian/status appears in app.py, console_v1, risk_v1, compatibility).

### Engine & Execution

The coordinator (`engine/coordinator.py`) implements a 9-step lifecycle:
validate → kill-switch → risk approval → route order → process fill → persist → WebSocket publish → audit log → guardian heartbeat.

**Deterministic**: same inputs produce same routing decisions. Mainnet gate blocks live execution.

### Risk System (3 layers, scattered)

1. **`logic/risk.py`** — Pure-function risk scoring (spread/depth/vol/shock → 0–100) and risk gate (HOLD/ENTER/EXIT)
2. **`engine/risk_rules.py`** — RiskRuleEngine with 6 pluggable rules (MaxPosition, PortfolioExposure, MaxDailyLoss, Volatility, Leverage, Slippage)
3. **`services/risk_gate/service.py`** — Pre-trade orchestrator chaining kill switch → scoped kills → rule engine

All three layers are individually sound but scattered across the codebase.

### Config System

**Sound and mature.** Two-layer: Pydantic BaseSettings (env + .env) + YAML defaults with env overrides. Startup validation via `config/loader.py`. Typed sub-config slices (ExchangeConfig, RiskConfig, DatabaseConfig). Thresholds are configurable, not hardcoded.

### Data Models

- **`models_core.py`** — Features, Signal, RiskDecision, MarketTick (dataclasses)
- **`models/decision_trace.py`** — DecisionTrace with signal/risk/execution/guardian snapshots (Pydantic)
- **`models/execution_intent.py`** — ExecutionIntent, IntentRequest, IntentResponse
- **`db/models/`** — SQLAlchemy ORM models + Alembic migrations

### Persistence

SQLAlchemy async (asyncpg for PostgreSQL, aiosqlite for SQLite). Repository pattern in `db/repositories/`. Audit store still uses JSON file persistence — should migrate to DB.

### Services (14)

| Service | Purpose | Status |
|---------|---------|--------|
| `audit/` | Audit trail persistence | Sound |
| `guardian_bot/` | Kill switch, drawdown monitoring | Sound |
| `market_data/` | Price feeds, ingestion, streaming | Sound |
| `monitoring/` | Health probes, alerts | Sound |
| `mt5_bridge/` | MetaTrader 5 connectivity | Sound |
| `portfolio/` | Portfolio state, lot tracking | Sound |
| `prediction_bot/` | AI-powered predictions | Sound (not wired) |
| `reconciliation/` | Drift detection | Sound |
| `risk_gate/` | Pre-trade validation | Sound |
| `signal_executor/` | Automated signal→order loop | Sound |
| `signal_service/` | Signal caching/evaluation | Sound |
| `surge_scanner/` | Momentum breakout detection | Sound |
| `portfolio_persistence.py` | Portfolio save/restore to DB | Sound |
| `websocket_manager.py` | WebSocket broadcast | Sound |

### Duplicate Code

- **`exchanges/`** (standalone clients) duplicates **`adapters/exchanges/`** — needs consolidation
- **PaperAdapter** in `logic/exchange_adapter.py` should live in `adapters/`

### Backend Verdict

**Mostly sound.** Core logic (engine, risk, signals, features, earnings, config) is well-implemented and tested. Key issues: monolith `app.py`, scattered risk code, duplicate exchange modules, `logic/` grab-bag needs splitting.

---

## Worker Architecture (Cloudflare)

127 TypeScript files across `worker/src/`. Handles rate limiting, paper trading, D1 database operations, R2 storage, KV agent memory, Durable Objects (per-portfolio state), cron triggers, and Bitget V3 client integration.

**Overlap concern**: Both the Worker and Python backend have signal/risk/execution logic. The boundary between them is not cleanly documented.

---

## Tests & CI

### Test Inventory

| Layer | Files | Tests | Type |
|-------|-------|-------|------|
| Backend (Python) | 29 | ~463 | Unit, integration, API contract |
| Frontend (TypeScript) | 8 | ~71 | Contract, integration |
| Worker | 0 in-tree | Unknown | Vitest config exists |

### Backend Test Coverage

**Covered**: api, risk, risk_gate, portfolio, indicators, signals, strategies, earnings, decision_trace, signal_engine, paper_trading, live_mode, audit_store, event_log, reconciliation, hardening, mt5, runtime_config, kill_switch, execution_scope.

**Missing tests for**: config/loader, engine/coordinator, engine/execution_router, engine/pnl, engine/state_machine, services/portfolio_persistence, services/websocket_manager, services/stream_service, individual route modules.

### CI/CD

- **16 GitHub Actions workflows** — `ci.yml` is manual (workflow_dispatch only)
- Safety workflows: production-lock, live-candidate-safety, withdrawals-candidate-safety, live-certification-safety
- Monitoring: render-keepalive (every 5 min), monitor
- CodeQL security scanning
- **No automatic CI on push/PR** — relies on CircleCI (config not in repo)

### Deployment

| Target | Config | Status |
|--------|--------|--------|
| Vercel (frontend) | `vercel.json` | Active |
| Render (Python backend) | `render.yaml`, `Dockerfile` | Active |
| Cloudflare (Worker) | `wrangler.toml` | Active |

### Scripts

46 scripts in `scripts/`: benchmarks, verification, smoke tests, audit, deployment helpers.

### Documentation

65+ docs in `docs/`, 10+ root-level .md files. All 8 target docs from CLAUDE.md exist but are stale (from PR #75 era).

---

## Key Risks

| # | Risk | Severity | Location |
|---|------|----------|----------|
| 1 | Monolith `app.py` (~1,400 lines, ~40 inline endpoints) | High | `backend/app.py` |
| 2 | Risk logic scattered across 3 modules | Medium | `logic/risk.py`, `engine/risk_rules.py`, `services/risk_gate/` |
| 3 | Duplicate exchange code | Medium | `exchanges/` vs `adapters/exchanges/` |
| 4 | `logic/` grab-bag (18 files, no clear boundary) | Medium | `backend/logic/` |
| 5 | Dual frontend API clients | Medium | `backendRuntime.ts` vs `api.ts` |
| 6 | Audit store uses JSON files, not DB | Medium | `logic/audit_store.py` |
| 7 | Worker/Python boundary undocumented | Medium | Worker and backend overlap |
| 8 | No automatic CI on push/PR | Medium | GitHub Actions manual only |
| 9 | 5 unreachable frontend pages | Low | `src/pages/` stubs |
| 10 | `lint` script references deleted file | Low | `package.json` |
