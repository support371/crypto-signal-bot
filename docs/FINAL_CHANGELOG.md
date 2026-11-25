# Final Changelog

> All changes delivered on the `claude/complete-trading-backend-qRGZk` branch.
> Updated November 2026.

## Summary

- **650+ backend tests** (up from ~247 at start of remediation), **97 frontend tests** (up from 55), **0 pre-existing failures remaining**
- **180+ new backend tests** added across venue registry, broker normalizer, coordinator, config loader, websocket manager, state machine, P&L engine, API contracts, execution router, portfolio persistence, signal endpoint, guardian scoped, reconciliation service
- **14 pre-existing test failures fixed** (10 in signal executor, 2 in market data, 1 signal gate, 1 intent/live)
- **8 test lint issues fixed** (F811, E401, F841, E702 across 6 test files)
- **42 new frontend component tests** added for Health, Audit, Settings, Portfolio pages
- **1,862 lines of dead code** removed (14 orphaned legacy files)
- **Ruff lint promoted to blocking** in CI (13 lint errors fixed)
- **CI enabled on push/PR** (was `workflow_dispatch` only)
- **Frontend cleaned** — API client consolidation, stub page deletion, hook extraction
- **Backend modularized** — route extraction from app.py monolith, audit/policy/risk module restructuring
- **9 documentation files** produced or refreshed (including Worker/Python boundary doc)
- **Landing page** built with feature grid and safety callout
- **Settings page** built with server config viewer and dashboard preferences
- **Portfolio page** built with positions table, order history, and live prices
- **Health page** built with backend service, guardian, market data, and monitoring probe sections
- **Audit page** built with tabbed intents, orders, and risk events views

---

## Phase 1: Backend Structural Refactor

### 1.1 Split `app.py` monolith (DONE)

Extracted inline endpoints into dedicated route modules:

- `backend/routes/audit_v1.py` — audit, traces, metrics endpoints
- `backend/routes/earnings_v1.py` — earnings summary, history, reset
- `backend/routes/analysis_v1.py` — analyze-features, simulate-session
- `backend/routes/config_v1.py` — config, version, mainnet-gate, runtime status
- `backend/routes/exchange_v1.py` — exchange status, supported, circuit breakers, surge
- `backend/routes/trading_v1.py` — balance, positions, orders, price, intent, withdraw
- `backend/routes/reconciliation_v1.py` — reconciliation status, exchange reconciliation

Created `backend/dependencies.py` with shared `require_auth` (sys.modules approach avoids import cycles).
Created `backend/app_state.py` lazy accessor module to avoid circular imports between route modules and app.py.
Created `backend/exceptions.py` for shared exception types (`ExchangeAPIError`) to break import cycles.
Fixed pre-existing test isolation bug in `test_api.py::TestRenderReadinessEndpoint` (save/restore `app.router.routes`).

**Files**: `backend/app.py`, `backend/app_state.py`, `backend/exceptions.py`, `backend/routes/*.py`, `backend/dependencies.py`

### 1.2 Risk module consolidation (PARTIAL)

Moved `logic/risk.py` → `backend/risk/scoring.py`. Remaining modules (`engine/risk_rules.py`, `services/risk_gate/`) already clean — moving is low-value churn.

### 1.3 Split `logic/` grab-bag (DONE)

Extracted pure modules:
- `logic/features.py`, `logic/indicators.py`, `logic/signals.py`, `logic/strategies.py` → `backend/policy/`
- `logic/risk.py` → `backend/risk/scoring.py`
- `logic/audit_store.py` → `backend/audit/store.py`
- `logic/decision_tracer.py` → `backend/audit/tracer.py`

Re-exports in place for all 60+ import sites.

### 1.4 Consolidate duplicate exchange code (DONE)

Removed `backend/exchanges/` (779 lines), `engine/gateway_service.py` (413 lines), `engine/withdrawal_manager.py` (218 lines — forbidden per CLAUDE.md).

### 1.5 Consolidate audit modules (DONE)

Created `backend/audit/` with `store.py` and `tracer.py`. All audit import sites updated.

### 1.6 Resolve duplicate endpoint paths (DONE)

Audited all routes programmatically — no duplicate paths found after route extraction.

---

## Phase 2: Frontend Cleanup

### 2.1 Consolidate API clients (DONE)

Deleted `api.ts`. All 3 consumers migrated to `@/lib/backend` (which has auth token injection).

### 2.2 Route or delete stub pages (DONE)

Deleted 4 stub pages (`Audit.tsx`, `Positions.tsx`, `Guardian.tsx`, `Health.tsx`). Routed `PrivacyPolicy.tsx` at `/privacy`.

### 2.3 Fix stale lint script (DONE)

Updated `package.json` lint script to reference current files.

### 2.4 Extract Index.tsx state (DONE)

Extracted auto-trade effect and 8 WebSocket callback handlers into `src/hooks/useDashboardOrchestration.ts`. Index.tsx reduced from 710 → 577 lines.

**New hook**: `useDashboardOrchestration` — handles `handleHealthUpdate`, `handleGuardianAlert`, `handleKillSwitchChange`, `handleMarketUpdate`, `handleExchangeStatus`, `handleOrderUpdate`, `handlePortfolioActionComplete`, `handleEarningsReset`, `handleTickerUpdate`, `clearAutoTradeSignature`.

---

## Phase 3: CI & Testing

### 3.1 Enable automatic CI on push/PR (DONE)

Added `push` and `pull_request` triggers to `.github/workflows/ci.yml`. Both frontend build and backend test suite run on every push to main and PR.

### 3.2 Expand backend test coverage (DONE)

**New test files**:

| File | Tests | Coverage |
|------|-------|----------|
| `test_coordinator_validation.py` | 16 | Intent validation, boundary values, exception types |
| `test_venue_registry.py` | 17 | Register, availability, symbol filtering |
| `test_broker_normalizer.py` | 14 | Order/position/fill/health normalization |
| `test_config_loader.py` | 12 | Sub-config accessors, frozen enforcement, URL redaction |
| `test_websocket_manager.py` | 13 | Connect/disconnect, broadcast, dead-client cleanup |
| `test_state_machine.py` | 16 | Valid/invalid transitions, terminal states, helpers |
| `test_pnl.py` | 12 | FIFO lot matching, partial sells, balance tracking |
| `test_execution_router.py` | 13 | Venue routing (exchange + MT5), error propagation, BrokerRoutedOrder normalization |
| `test_portfolio_persistence.py` | 10 | Restore, persist, order save, DB error resilience, mode parameter |
| `test_signal_endpoint.py` | 6 | Prediction-service signal endpoint, side mapping, symbol normalization |
| `test_guardian_scoped.py` | 43 | Scoped kill switches, reconciliation drift, cooldown, runtime thresholds, context mirroring |

### 3.3 Add frontend component tests (DONE)

Installed `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `vite-tsconfig-paths`. Fixed `vitest.config.ts` to use jsdom environment and tsconfigPaths plugin for `@/` alias resolution.

**New test files**:

| File | Tests | Coverage |
|------|-------|----------|
| `Health.test.tsx` | 12 | Rendering, loading, unreachable, probes, uptime formatting |
| `Audit.test.tsx` | 13 | Tab switching, intents/orders/risk, empty states, refetch |
| `Settings.test.tsx` | 8 | Sections, guardian, market data, paper mode |
| `Portfolio.test.tsx` | 9 | Stats, orders, positions, empty states, side indicators |

**Fixes**: 3 existing tests annotated with `@vitest-environment node` for `readFile` + `import.meta.url` compatibility. `certification_mode_copy.test.ts` updated to include `useDashboardOrchestration.ts` after Phase 2.4 hook extraction. ResizeObserver polyfilled for Radix UI slider components.

Total frontend tests: 97 (12 files), up from 55 (8 files).

### 3.4 Promote ruff to blocking (DONE)

Fixed 13 lint errors:
- Removed duplicate import in `app.py`
- Split 4 semicolon-joined statements in `broker_repos.py`
- Removed unused variables in `guardian_bot/service.py`, `market_data/service.py`, `monitoring/service.py`, `test_decision_trace.py`
- Fixed unreachable code in `market_data/service.py` (changed assigned-but-unused `stale_snapshot` to `return PriceSnapshot(...)`)
- Removed trailing whitespace in `0001_initial.py`

Removed `--exit-zero` from CI ruff step.

---

## Phase 4: Frontend Feature Completion (DONE)

### 4.1 Settings page (DONE)

Built full `Settings.tsx` with 4 read-only server config sections (system status, risk engine, guardian status, market data) and editable dashboard preferences (risk tolerance, volatility sensitivity, position size, spread stress threshold, auto-trade toggle, sound alerts). Uses `usePersistedSettings` for localStorage persistence. All server parameters read-only per paper-mode constraints.

### 4.2 Portfolio / Positions view (DONE)

Built full `Portfolio.tsx` with summary stats (total equity, cash balance, position value), open positions table with live prices and 24h change from `/price` endpoint, and recent order history table with color-coded buy/sell indicators and status badges (FILLED, REJECTED, etc.). Empty states for both sections.

### 4.4 Landing page (DONE)

Built polished `PublicHome.tsx` with product overview, feature grid (6 panels), paper trading callout, and safety-first messaging. Replaced minimal 28-line stub.

### 4.3 Standalone Health/Audit pages (DONE)

Built standalone `Health.tsx` with 4 sections (backend service, guardian, market data, monitoring probes with per-probe latency and failure counts) and standalone `Audit.tsx` with 3 tabbed views (intents, orders, risk events) showing full history tables with status badges, side indicators, and risk score coloring. Both pages wired to `/health` and `/audit` routes in `AppCore.tsx`.

---

## Phase 5: Engine & Integration (PARTIAL)

### 5.2 Worker/Python boundary documentation (DONE)

Produced `docs/WORKER_PYTHON_BOUNDARY.md` covering:
- Two-runtime architecture table (Worker on Cloudflare vs Backend on FastAPI)
- Complete route ownership map for both runtimes
- Data flow diagram (frontend → edge/origin → databases)
- Shared concern analysis: market data, signal engine, guardian state, paper orders, audit
- Safety invariant comparison (both runtimes enforce paper mode independently)
- Frontend configuration and routing
- Unification roadmap (signal sync, single guardian, order reconciliation, shared audit, API gateway)

### 5.1 Wire prediction bot (DONE)

Replaced market_state-cached `/signal/latest` with prediction service-backed endpoint in `routes/signal.py`. Added `side` field for backward compatibility (`UP`→`BUY`, `DOWN`→`SELL`, `NEUTRAL`→`NEUTRAL`), `message` field for unavailable state. Frontend normalizer (`paperSignal.ts`) updated to prefer `direction` over `side` and pass through `regime`/`horizon`.

**New tests**: `test_signal_endpoint.py` (6 tests) — no-symbol unavailable, shape, unavailable message, side mapping, symbol normalization, prediction status.

---

## Phase 6: Documentation Refresh (DONE)

All 8 target documents refreshed to match current implementation:

| Document | Status |
|----------|--------|
| `ARCHITECTURE_AUDIT.md` | Refreshed — full module map, risk inventory |
| `REMEDIATION_PLAN.md` | Refreshed — phased plan with progress tracking |
| `DECISION_TRACE_SPEC.md` | Refreshed — verified against `models/decision_trace.py` and `audit/tracer.py` |
| `API_CONTRACTS.md` | Refreshed — full endpoint inventory (90+ routes), auth requirements, WS message types |
| `FRONTEND_STRUCTURE.md` | Refreshed — current component tree, routing table, hook inventory |
| `BACKEND_STRUCTURE.md` | Refreshed — current module map post-restructuring |
| `RUNBOOK_LOCAL.md` | Refreshed — verified setup instructions, added ruff flags |
| `FINAL_CHANGELOG.md` | This file |

---

## Dead Code Removal

Removed 1,862 lines across 14 files:

| File | Lines | Reason |
|------|-------|--------|
| `backend/exchanges/` (directory) | 779 | Duplicated `adapters/exchanges/` |
| `engine/gateway_service.py` | 413 | Used removed `exchanges/` |
| `engine/withdrawal_manager.py` | 218 | Forbidden per CLAUDE.md |
| `src/services/api.ts` | ~100 | Superseded by `backendRuntime.ts` |
| `src/pages/Audit.tsx` | ~50 | Dashboard panel covers this |
| `src/pages/Positions.tsx` | ~50 | Superseded by Portfolio |
| `src/pages/Guardian.tsx` | ~50 | Dashboard panel covers this |
| `src/pages/Health.tsx` | ~50 | Dashboard panel covers this |
| Various legacy auth/provider files | ~150 | Orphaned after refactor |

---

## Bug Fixes

- **`market_data/service.py`**: `stale_snapshot` assigned but never returned — changed to `return PriceSnapshot(...)` and removed unreachable `raise`
- **`app.py`**: Removed duplicate import of `earnings_v1_router`
- **`guardian_bot/service.py`**: Removed unused `cfg = get_risk_config()` assignments
- **`monitoring/service.py`**: Removed unused `prev_ok` variable
- **`test_audit_store_event_log.py`**: Fixed broken import after `logic/audit_store.py` → `audit/store.py` move
- **`signal_executor/service.py`**: Fixed 4 broken `decision_tracer.record()` calls that used `HoldReason` as an enum when it's a dataclass — added `_trace_hold()` helper
- **`test_signal_executor.py`**: Rewrote 10 tests that referenced deleted `_execute_symbol()` to use `_executor_sweep()` with proper mocks
- **`routes/price.py`**: Added stale header (`X-Market-Data-Stale`) when `get_price()` returns stale snapshot (not just on exception path)
- **`test_market_data.py`**: Updated staleness test to match current service behavior (stale snapshot return, not exception)
- **`test_coordinator_signal_gate.py`**: Fixed `test_evaluate_uppercases_symbol` — route now passes `strategy` kwarg to `evaluate_signal()`
- **`test_exchange_endpoints.py`**: Fixed `test_intent_live_returns_403` — endpoint returns string detail, not dict

---

## Remaining Work

### Low priority (blocked)
- Live adapter integration tests (Phase 7) — requires owner authorization
- Double-prefix route cleanup — cosmetic, all endpoints functional
