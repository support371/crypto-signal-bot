# Final Changelog

> All changes delivered in PR #75 (integration remediation).

## Summary

- **247 tests passing** (was 230 pass / 17 fail before Phase 6)
- **44 new tests** added (16 earnings + 28 market data)
- **17 pre-existing test failures fixed** (API contract alignment)
- **Risk engine bug fixed** (was blocking all paper trades)
- **CI: 11/12 checks pass** (1 pre-existing Vercel config failure)
- **8 documentation files** produced

## Changes by Phase

### Phase 1: Critical Integration Fixes

**`backend/app.py`**
- Wired reconciliation service into app lifespan (`start_reconciliation()` / `stop_reconciliation()`)
- Added `GET /reconciliation/status` endpoint

**`backend/config/config.yaml`**
- Removed duplicate `bitget` and `btcc` exchange sections (lines 21-35)

### Phase 2: Complete Incomplete Implementations

**`backend/logic/paper_trading.py`**
- Added dust cleanup in `simulate_fill()` SELL path — removes asset from balances when residual < $0.01

**`backend/logic/rate_limit.py`**
- Added `threading.Lock` for thread-safety
- Added 60-second expiry to `_rate_limit_store` entries (prevents memory leak)
- Entries older than 60s are pruned on each request

### Phase 3: Test Coverage

**`backend/tests/test_market_data.py`** (new, 28 tests)
- Binance, Bitget, BTCC REST response parsing
- Stale data detection
- Status/callback lifecycle

**`backend/tests/test_earnings.py`** (new, 16 tests)
- FIFO lot matching
- Partial fills
- Short sells
- Multi-symbol tracking
- Persistence simulation

### Phase 4: Deployment Configuration

**`.env.example`**
- Documented all environment variables
- Added sections for Vercel, Render, and local deployment targets

### Phase 5: Code Quality

**`backend/config/mode_control.py`**
- Removed dead `ModeControl` class (unused, `TRADING_MODE` loaded via runtime config)

**Multiple backend files**
- Added return type hints

### Phase 6: API Contract Cleanup (17 test failures fixed)

**`backend/app.py`**
- Health endpoint: added `halted`, `guardian_triggered`, `market_data_mode`, `market_data_connected`, `market_data_source`
- New `GET /exchange/status` endpoint with 12-field market data schema
- Price endpoint: added 404 for untracked symbols (hybrid mode), 503 for unavailable market data, 503 for missing execution adapter
- Removed `price_router` inclusion (was shadowing app.py route with stricter param requirements)

**`backend/routes/kill_switch.py`**
- Changed `require_operator_key()` from importing `backend.app` to reading `context.BACKEND_API_KEY` directly
- Eliminated circular import (`backend.app → backend.routes.kill_switch → backend.app`)

**`backend/routes/compatibility.py`**
- Updated `hosted_health()` to include same new fields as main health endpoint

**`backend/tests/test_api.py`**
- Test fixture: reset `context.*` attributes instead of `app_module.*`
- Added `guardian_service.*` global reset between tests
- `auth_client` fixture: sets both `app_module.BACKEND_API_KEY` and `context_module.BACKEND_API_KEY`
- Rate limiter test: hits `/balance` (rate-limited) instead of `/health` (not rate-limited)
- WebSocket test: added message draining logic (up to 5 messages) to find correct broadcast type

**`backend/tests/test_live_mode.py`**
- Changed market data service references from `app_module.market_data_service` to `ctx.market_data_service`

### Risk Engine Fix

**`backend/app.py`** (`_process_intent()`)
- Uses symbol-specific position value (`paper_portfolio.get_balance(base_asset) * current_price`) instead of total portfolio exposure
- Computes non-cash exposure separately for `current_total_exposure`
- Guardian drawdown uses total equity (`get_total_exposure()`) instead of USDT-only balance

**`backend/engine/risk_rules.py`**
- `MaxPositionRule`: SELL orders return early with `approved=True`
- `PortfolioExposureRule`: SELL orders return early with `approved=True`
- `LeverageRule`: SELL orders return early with `approved=True`
- Rationale: In a long-only system, selling always reduces risk

**`backend/logic/context.py`**
- Added `guardian_starting_nav` field (used for drawdown calculation)

## Files Changed

| File | Lines Added | Lines Removed |
|------|------------|--------------|
| `backend/tests/test_market_data.py` | 362 | 0 |
| `backend/tests/test_earnings.py` | 323 | 0 |
| `backend/app.py` | 92 | 12 |
| `backend/tests/test_api.py` | 71 | 30 |
| `backend/logic/rate_limit.py` | 61 | 14 |
| `backend/config/mode_control.py` | 2 | 28 |
| `.env.example` | 25 | 3 |
| `backend/engine/risk_rules.py` | 22 | 9 |
| `backend/logic/paper_trading.py` | 14 | 5 |
| `backend/routes/compatibility.py` | 9 | 2 |
| `backend/routes/kill_switch.py` | 8 | 5 |
| `backend/tests/test_live_mode.py` | 7 | 5 |
| `backend/config/config.yaml` | 0 | 6 |
| `backend/logic/context.py` | 4 | 2 |

## Documentation Produced (Phase 7)

| Document | Description |
|----------|-------------|
| `docs/ARCHITECTURE_AUDIT.md` | System overview, module map, risks |
| `docs/REMEDIATION_PLAN.md` | Completed work + remaining priorities |
| `docs/DECISION_TRACE_SPEC.md` | Structured trace format specification |
| `docs/API_CONTRACTS.md` | All endpoint schemas with examples |
| `docs/FRONTEND_STRUCTURE.md` | Frontend directory, routing, design system |
| `docs/BACKEND_STRUCTURE.md` | Backend directory, patterns, deployment |
| `docs/RUNBOOK_LOCAL.md` | Local development setup guide |
| `docs/FINAL_CHANGELOG.md` | This file |

## Remaining Risks

1. **In-memory state**: Portfolio, earnings, audit trail lost on restart
2. **Prediction bot**: Service exists but not integrated into engine
3. **Engine coordinator**: Stub — needs implementation for multi-strategy
4. **Live mode untested**: Adapter paths exist but no integration tests
5. **Vercel vbuy deployment**: Pre-existing failure, unrelated to this PR
