# Remediation Plan

> Tracks what was fixed, what remains, and priorities for future work.

## Completed Remediation (PR #75)

### Phase 1: Critical Integration Fixes
- [x] Kill-switch routes verified wired into main app
- [x] Config YAML duplicates removed (bitget/btcc)
- [x] Reconciliation service wired into lifespan + `/reconciliation/status` endpoint

### Phase 2: Incomplete Implementations
- [x] Paper trading SELL dust cleanup (sub-penny residuals removed)
- [x] Rate limiter thread-safety + memory leak fix (60s expiry, `threading.Lock`)

### Phase 3: Test Coverage
- [x] `test_market_data.py` — 28 tests (Binance/Bitget/BTCC REST, stale detection, callbacks)
- [x] `test_earnings.py` — 16 tests (FIFO matching, partial fills, short sells, persistence)

### Phase 4: Deployment Configuration
- [x] `.env.example` documented for Vercel vs local deployment

### Phase 5: Code Quality
- [x] Dead `ModeControl` class removed from `backend/config/mode_control.py`
- [x] Type hints added across backend files

### Phase 6: API Contract Cleanup (17 test failures fixed)
- [x] Health endpoint — added `halted`, `guardian_triggered`, `market_data_mode/connected/source`
- [x] New `/exchange/status` endpoint — full market data state
- [x] Price endpoint — proper 404/503 error handling for hybrid/live modes
- [x] Test fixture — reset `context.*` instead of `app_module.*`
- [x] Guardian service state leakage — reset globals between tests
- [x] Kill-switch auth — use `context.BACKEND_API_KEY` (eliminated circular import)
- [x] Rate limiter test — hit rate-limited endpoint (`/balance` instead of `/health`)
- [x] Removed price_router shadowing (was breaking `GET /price` without params)

### Risk Engine Fix
- [x] `_process_intent()` — uses symbol-specific position value (was using total portfolio)
- [x] Risk rules — SELL orders always approved (reduces risk, never increases it)
- [x] Guardian drawdown — uses total equity instead of USDT-only balance

### Phase 7: Documentation (PR #75)
- [x] `ARCHITECTURE_AUDIT.md` — System overview, module map, dependency status
- [x] `REMEDIATION_PLAN.md` — Completed work + prioritized remaining items
- [x] `DECISION_TRACE_SPEC.md` — Structured trace format specification
- [x] `API_CONTRACTS.md` — Every endpoint with request/response schemas
- [x] `FRONTEND_STRUCTURE.md` — React app layout, routing, hooks
- [x] `BACKEND_STRUCTURE.md` — FastAPI module map, patterns, deployment
- [x] `RUNBOOK_LOCAL.md` — Local dev setup guide with troubleshooting
- [x] `FINAL_CHANGELOG.md` — Complete changelog for all phases

## Completed Hardening Layers (PR #76 + #77)

### Database Persistence
- [x] SQLite persistence for paper portfolio state (survives restarts)
- [x] Persist orders + audit to database
- [x] Composite PK (asset, mode) so paper/live can coexist

### Testnet Validation
- [x] `/exchange/validate` endpoint — 4 connectivity checks
- [x] Exchange adapter health verification

### Exchange Reconciliation
- [x] `/reconciliation/exchange` endpoint — balance drift detection
- [x] Zero-balance drift flagging for untracked exchange assets

### Mainnet Gate Enforcement
- [x] `ALLOW_MAINNET` flag enforcement in code (blocks live+mainnet without flag)
- [x] `/mainnet-gate/status` endpoint
- [x] Graceful fallback to PaperAdapter on gate block (no crash)
- [x] Consistent parsing: "1", "true", "yes" all accepted

### Retry Logic
- [x] Exponential backoff for exchange API calls
- [x] `with_retry(fn, max_retries=N)` utility + `RetryableAdapter`

### Review Fixes (PR #77)
- [x] `ALLOW_MAINNET` parsing consistency (was only "true", now "1"/"yes"/"true")
- [x] App crash at import time → graceful PaperAdapter fallback
- [x] Rejected orders (mainnet gate, guardian, risk engine) persisted to DB

## Completed System Stabilization (PR #79)

### WebSocket Server
- [x] Persistent `/ws` endpoint with connection manager
- [x] Heartbeat ping/pong every 10s
- [x] Ticker broadcast (BTC, ETH, SOL, BNB) every 3s
- [x] Multi-client support with disconnect cleanup
- [x] Reconnect-safe, async-safe

### Frontend Resilience
- [x] Exponential backoff reconnect (1s → 30s max)
- [x] Tab resume/mobile wake reconnection
- [x] WS ONLINE/OFFLINE status indicator with green/red dots
- [x] Continuous CSS ticker animation (independent from WS timing)
- [x] Backend readiness gate (shows "Connecting..." instead of broken UI)

### Render Uptime
- [x] `/ping` endpoint (responds under 50ms)
- [x] GitHub Actions keepalive workflow (every 5 min)
- [x] Startup warm cache (preload ticker data)

### Database Modernization
- [x] PostgreSQL-ready persistence layer (SQLAlchemy async)
- [x] SQLite for local dev, Postgres for production

## Completed Market Data Fix (PR #81)

### Live Market Data
- [x] `PAPER_USE_LIVE_MARKET_DATA=true` by default
- [x] CoinGecko as primary public market data source (Binance geo-blocked on Render)
- [x] `_get_live_price_for_ticker()` checks market data service snapshot first
- [x] Fallback chain: live snapshot → signal cache → synthetic

## Completed Phase 8 (Current PR)

### CI Improvements
- [x] Full pytest suite (`backend/tests/`) added to CircleCI, GitHub Actions CI, production-lock, and release-check
- [x] Ruff linting added to all CI workflows (advisory mode with `--exit-zero`)
- [x] `ruff>=0.4` added to backend requirements
- [x] All workflows now verify `backend/public_app.py` import surface

### Deterministic Decision Trace System
- [x] `backend/models/decision_trace.py` — Pydantic model with signal, risk, execution, guardian snapshots
- [x] Trace construction wired into `_process_intent()` — every trading decision emits a structured trace
- [x] Trace persistence in audit store (`append_trace`, `get_traces`)
- [x] `GET /traces` endpoint (filterable by symbol, status, limit)
- [x] `GET /trace/{intent_id}` endpoint for individual trace lookup
- [x] 10 new tests covering model, serialization, API endpoints, risk rule capture, guardian state capture

### Frontend Polish
- [x] `onHealthUpdate` callback wired to dashboard — real-time health refresh via WS
- [x] All 7 WS message types fully wired to dashboard panels
- [x] Settings persistence via localStorage (already existed, verified working)
- [x] Backend readiness gate (already existed from PR #79, verified working)

## Remaining Work

### Priority 1: Engine Completion
- [ ] Implement `engine/coordinator.py` for multi-strategy orchestration
- [ ] Wire prediction bot service into engine pipeline

### Priority 2: Frontend vNext
- [ ] Positions view panel
- [ ] Settings/config screen improvements
- [ ] Health/metrics view improvements

### Priority 3: Lint Cleanup
- [ ] Fix pre-existing ruff errors (F401 unused imports, E402 module-level imports)
- [ ] Promote ruff from advisory to blocking in CI

### Priority 4: Live Mode Preparation
- [ ] Integration tests for Binance/Bitget/BTCC live adapters
- [ ] Testnet validation with real exchange credentials

### Priority 5: CI Cleanup
- [ ] Fix `Vercel – crypto-signal-bot-vbuy` deployment (pre-existing failure, requires Vercel UI removal)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Engine coordinator stub | Medium | Priority 1: implement multi-strategy orchestration |
| No live adapter integration tests | Medium | Priority 4: testnet validation required before live enablement |
| Prediction bot not integrated | Low | Priority 1: stub exists, needs wiring |
| Ruff errors in CI (advisory) | Low | Priority 3: cosmetic, doesn't affect runtime |
| Duplicate Vercel project | Low | Priority 5: requires manual Vercel UI cleanup |
