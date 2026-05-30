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

## Remaining Work

### Priority 1: Persistence
- [ ] Add SQLite/Postgres persistence for paper portfolio state
- [ ] Persist earnings ledger across restarts
- [ ] Persist audit trail to database (currently in-memory JSON)

### Priority 2: Engine Completion
- [ ] Implement `engine/coordinator.py` for multi-strategy orchestration
- [ ] Wire prediction bot service into engine pipeline
- [ ] Add deterministic decision trace objects per CLAUDE.md spec

### Priority 3: Frontend Polish
- [ ] Wire real-time WebSocket updates to all dashboard panels
- [ ] Add settings persistence (currently in localStorage)
- [ ] Implement proper error states for backend unavailability

### Priority 4: Live Mode Preparation
- [ ] Integration tests for Binance/Bitget/BTCC live adapters
- [ ] Testnet validation with real exchange credentials
- [ ] Add mainnet gate (`ALLOW_MAINNET` flag) enforcement

### Priority 5: Lint Cleanup
- [ ] Fix pre-existing ruff errors (F401 unused imports, E402 module-level imports)
- [ ] Add ruff to CI pipeline

### Priority 6: CI Improvements
- [ ] Fix `Vercel – crypto-signal-bot-vbuy` deployment (pre-existing failure)
- [ ] Add full pytest suite to CircleCI (currently only runs stabilization contract)
- [ ] Add ruff lint check to CI

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| In-memory state loss on restart | High | Priority 1: add persistence layer |
| No live mode testing | Medium | Priority 4: testnet validation required before any live enablement |
| Prediction bot not integrated | Low | Priority 2: stub exists, needs wiring |
| Lint errors in CI | Low | Priority 5: cosmetic, doesn't affect runtime |
