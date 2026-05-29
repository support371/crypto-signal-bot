# Architecture Audit

> Generated from repository analysis — PR #75 integration remediation.

## System Overview

Crypto-signal-bot is a modular cryptocurrency trading platform supporting **paper**, **hybrid**, and **live** execution modes. It consists of a FastAPI backend, a React + TypeScript frontend, and deployment targets on Render (backend), Vercel (frontend), and Railway (preview).

```
Frontend (Vercel)          Backend (Render/Docker)
┌──────────────────┐       ┌──────────────────────────────────┐
│ React + Vite SPA │──────▶│ FastAPI (uvicorn)                 │
│ TailwindCSS      │  API  │ ├── engine/   (risk, routing)     │
│ ShadCN/Radix UI  │◀──────│ ├── logic/    (signals, trades)   │
│ Recharts         │  WS   │ ├── services/ (guardian, recon)   │
│ React Router     │       │ ├── adapters/ (exchanges, brokers)│
└──────────────────┘       │ ├── db/       (SQLite/Postgres)   │
                           │ └── routes/   (API endpoints)     │
                           └──────────────────────────────────┘
```

## Backend Module Map

| Module | Responsibility | State |
|--------|---------------|-------|
| `backend/app.py` | FastAPI application, lifespan, all route definitions | Sound — primary orchestrator |
| `backend/config/` | YAML config loader, runtime env override | Sound — `runtime.py` is the entrypoint |
| `backend/engine/risk_rules.py` | Risk rule engine (position, exposure, leverage, volatility, slippage, daily loss) | Fixed — SELL orders now always approved |
| `backend/engine/execution_router.py` | Multi-venue order routing | Present but not yet wired to live |
| `backend/engine/coordinator.py` | Engine orchestration | Stub — needs implementation |
| `backend/logic/paper_trading.py` | Paper portfolio, `simulate_fill()`, dust cleanup | Sound — BUY/SELL both work |
| `backend/logic/exchange_adapter.py` | Exchange adapter abstraction (Paper/Binance/Bitget/BTCC) | Sound — adapter pattern works |
| `backend/logic/earnings.py` | FIFO lot matching, realized/unrealized P&L | Sound — 16 tests covering edge cases |
| `backend/logic/signals.py` | Signal classification (TREND/RANGE/CHAOS) | Sound — preserved from original |
| `backend/logic/features.py` | Feature extraction (spread, imbalance, velocity) | Sound — preserved from original |
| `backend/logic/risk.py` | Risk scoring | Sound — preserved from original |
| `backend/logic/context.py` | Shared mutable state module | Sound — canonical state source |
| `backend/logic/rate_limit.py` | Per-IP rate limiting with thread-safety | Fixed — memory leak patched, Lock added |
| `backend/logic/audit_store.py` | JSON audit trail persistence | Sound |
| `backend/logic/market_data.py` | Market data aggregation | Sound |
| `backend/logic/market_state.py` | Signal/market state caching for WebSocket broadcasts | Sound |
| `backend/services/guardian_bot/` | Guardian safety monitor (drawdown, API errors, kill-switch) | Sound |
| `backend/services/reconciliation/` | Periodic balance/position reconciliation | Sound — wired into lifespan |
| `backend/services/market_data/` | Live market data streaming (Binance/Bitget/BTCC WebSocket + REST fallback) | Sound — 28 tests |
| `backend/services/prediction_bot/` | ML prediction service | Stub — not yet integrated |
| `backend/services/mt5_bridge/` | MetaTrader 5 broker integration | Present — has tests |
| `backend/adapters/exchanges/` | Exchange-specific adapter implementations | Present — Binance, Bitget, BTCC |
| `backend/adapters/brokers/` | Broker adapter (MT5) | Present |
| `backend/routes/kill_switch.py` | Kill-switch API (global + scoped) | Fixed — auth uses context module |
| `backend/routes/compatibility.py` | Hosted health routes for Render | Fixed — includes new health fields |
| `backend/db/` | SQLAlchemy models, migrations, event log | Present — SQLite default |
| `backend/middleware/auth.py` | API key authentication middleware | Sound |
| `backend/models/` | Pydantic models (ExecutionIntent, RiskContext, etc.) | Sound |

## Frontend Module Map

| Module | Responsibility | State |
|--------|---------------|-------|
| `src/pages/Index.tsx` | Main dashboard (authenticated) | Sound |
| `src/pages/PublicHome.tsx` | Public landing page | Sound |
| `src/pages/Auth.tsx` | Supabase authentication | Sound |
| `src/pages/Waitlist.tsx` | Waitlist signup | Sound |
| `src/components/dashboard/` | Dashboard panels (Portfolio, Signal, Guardian, Earnings, Audit, etc.) | Sound — 14 components |
| `src/components/ui/` | ShadCN primitives (button, card, dialog, etc.) | Sound — 50+ components |
| `src/hooks/` | Backend data fetching hooks (usePortfolio, useGuardianStatus, etc.) | Sound — 12 hooks |
| `src/contexts/` | Auth context (Supabase) | Sound |
| `src/integrations/supabase/` | Supabase client configuration | Sound |

## Circular Dependency Status

**No circular imports detected.** The kill-switch auth previously imported `backend.app` which created a cycle (`backend.app → backend.routes.kill_switch → backend.app`). This was eliminated by reading `context.BACKEND_API_KEY` directly.

## Configuration Architecture

```
config.yaml (defaults)
    ↓ overridden by
Environment variables (TRADING_MODE, NETWORK, EXCHANGE, etc.)
    ↓ loaded by
backend/config/runtime.py → RuntimeConfig dataclass
    ↓ consumed by
backend/app.py (module-level constants)
backend/logic/context.py (shared mutable state)
```

## Data Flow

```
Signal Input → Feature Extraction → Signal Classification → Risk Scoring
    ↓                                                           ↓
Market State (cached in context)                    Risk Rule Engine
    ↓                                                           ↓
WebSocket Broadcast ←──────────── Intent Processing ────→ Paper Fill / Adapter
    ↓                                                           ↓
Frontend Dashboard                                    Audit Store + Earnings Ledger
```

## Key Risks

1. **No persistence across restarts**: Paper portfolio, audit trail, and earnings are in-memory. Server restart loses all state.
2. **Prediction bot not integrated**: `services/prediction_bot/` exists but is not wired into the engine.
3. **Engine coordinator is a stub**: `engine/coordinator.py` needs implementation for multi-strategy orchestration.
4. **Live mode untested**: All testing is in paper mode. Live adapter paths exist but have no integration tests.
5. **Frontend auth depends on Supabase**: If Supabase is not configured, the frontend falls back to unauthenticated mode.
