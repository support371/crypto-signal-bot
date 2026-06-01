# ARCHITECTURE_AUDIT.md
**Project:** support371/crypto-signal-bot
**Audit Date:** 2026-06-01
**Auditor:** Base44 Super Agent Developer
**Status:** Read-only audit — no application code changed.

---

## 1. Current Stack

| Layer | Technology | Deployment |
|-------|-----------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind | Vercel |
| Backend | Python 3.11 + FastAPI + Pydantic v2 | Render (free tier) |
| DB | SQLite (default) / PostgreSQL (optional via DATABASE_URL) | Render disk / external |
| Auth | Supabase (frontend) + X-API-Key (backend write gates) | Supabase cloud |
| Market Data | CoinGecko (primary) + Binance.US OHLCV (secondary) | Public APIs |
| WebSocket | FastAPI native /ws + /ws/updates | Render |
| CI | CircleCI .circleci/config.yml | Cloud |

---

## 2. Working Pieces (Verified)

### Backend
- [OK] FastAPI app starts cleanly via lifespan context
- [OK] /health, /healthz, /api/health, /ping, /ready endpoints
- [OK] Paper trading portfolio (PaperPortfolio)
- [OK] Signal engine (/api/v1/signals/public, /api/v1/signals/{symbol})
- [OK] Signal executor — fires paper trades at confidence >= 0.75
- [OK] Guardian monitor — drawdown, API errors, kill-switch state
- [OK] Risk gate — compute_risk_score() + risk_gate() with configurable thresholds
- [OK] RiskRuleEngine — evaluates rules, produces RuleTrace[]
- [OK] DecisionTrace model — typed with signal, risk, execution, guardian snapshots
- [OK] Audit store — append-only in-memory + optional SQLite persistence
- [OK] MainnetGate — blocks live mainnet unless ALLOW_MAINNET=true
- [OK] Exchange retry + circuit breaker (backend/adapters/exchanges/retry.py)
- [OK] Binance.US OHLCV adapter (binance_us_ohlcv.py) — public candle data
- [OK] Bitget adapter (bitget.py) — public data + HMAC auth scaffolded
- [OK] BTCC adapter (btcc.py) — public data + HMAC auth scaffolded
- [OK] CoinGecko adapter (coingecko.py) — primary market data, 15s cache
- [OK] Portfolio persistence (SQLite)
- [OK] Reconciliation service (backend/services/reconciliation/service.py)
- [OK] WebSocket manager — /ws and /ws/updates functional
- [OK] Rate limiting middleware (token bucket)
- [OK] Auth middleware (X-API-Key on write routes when BACKEND_API_KEY set)
- [OK] /metrics endpoint (Prometheus-style)
- [OK] /exchange/circuit-breakers endpoint
- [OK] Config via config.yaml + env overrides
- [OK] 320 tests passing, 3 skipped, 0 failures

### Frontend
- [OK] React + Vite builds successfully
- [OK] Auth flow via Supabase (email/password + Google)
- [OK] ProtectedRoute wraps / — redirects unauthenticated users to /auth
- [OK] Dashboard Index.tsx — price chart, signal panel, risk gauge, portfolio
- [OK] useBackendWebSocket.ts — connects to /ws/updates
- [OK] useBackendStatus.ts, useGuardianStatus.ts, usePortfolio.ts, useSignalEngine.ts
- [OK] Vercel deployment live at crypto-signal-bot-indol.vercel.app
- [OK] SPA rewrites in vercel.json

---

## 3. Broken Pieces

### Critical
- [FAIL] No Coinbase adapter — backend/adapters/exchanges/coinbase.py does not exist
- [FAIL] No live.py adapter — backend/adapters/exchanges/live.py does not exist (must raise NotImplementedError)
- [FAIL] Operator API key in localStorage — src/lib/operatorAuth.ts writes OPERATOR_API_KEY_STORAGE_KEY to localStorage. Security gap.
- [FAIL] /intent/live can reach live execution if TRADING_MODE=live in env. Route does not return 403. Relies only on MainnetGate check inside _process_intent.
- [FAIL] POST /withdraw is functional in paper mode. Withdrawals are not explicitly disabled at route level.

### High
- [FAIL] No replay system — backend/replay/ does not exist. No replayer.py, no determinism tests.
- [FAIL] No GET /exchange/supported endpoint — support matrix for Binance/Bitget/BTCC/Coinbase missing.
- [FAIL] No GET /market/feed/status endpoint — feed status buried inside /exchange/status.
- [FAIL] No WS /stream — only /ws and /ws/updates exist. /stream required as final canonical WebSocket.
- [FAIL] No GET /config/snapshot endpoint — missing.
- [FAIL] No GET /runtime/status endpoint — missing.
- [FAIL] No GET /version endpoint — missing.
- [FAIL] No POST /exchange/test-connection endpoint — missing.
- [FAIL] Hardcoded thresholds outside config — 0.65/0.75 confidence values, 0.75/1.25 conf_mult scalars, 10000.0 starting NAV scattered in logic/signals.py, logic/risk.py, logic/context.py, logic/strategies.py.
- [FAIL] HOLD decisions not traced — DecisionTrace only created when an intent is processed. Passive HOLD cycles are invisible.
- [FAIL] No config_snapshot_hash field on DecisionTrace model.

### Medium
- [FAIL] Frontend components call fetch() directly — useAIInsights.ts and useCryptoPrices.ts bypass the API client layer.
- [FAIL] No src/lib/apiClient.ts — two separate wrappers (api.ts + backend.ts) instead of one canonical client.
- [FAIL] No src/lib/streamClient.ts — canonical WebSocket abstraction missing.
- [FAIL] No src/hooks/useStream.ts, useExchangeStatus.ts.
- [FAIL] No src/components/SystemStatusBanner.tsx, SafeModePanel.tsx, ExchangeStatusCard.tsx, BackendStatusCard.tsx, GuardianBlockList.tsx.
- [FAIL] Missing frontend routes: /dashboard, /positions, /portfolio, /guardian, /audit, /health, /settings, /reset-password.
- [FAIL] / is protected, not public. Brief requires / to be a public landing page.
- [FAIL] No WebSocket reconnect with exponential backoff + connection status tracking.

### Low / Polish
- [WARN] Supabase wording in UI — should read "Base44 Managed Auth" per brief.
- [WARN] Mobile layout not fully verified per route at 375px.
- [WARN] No ARIA audit (focus states, alt text, keyboard flow).
- [WARN] SQLite on Render free tier — ephemeral disk; data lost on restart.

---

## 4. Missing Pieces (Net New)

| Item | Location | Priority |
|------|---------|---------|
| Coinbase adapter | backend/adapters/exchanges/coinbase.py | Critical |
| Live adapter (NotImplementedError) | backend/adapters/exchanges/live.py | Critical |
| Replay system | backend/replay/replayer.py | High |
| Replay determinism test | tests/test_replay_determinism.py | High |
| Reconciliation drift test | tests/test_reconciliation_drift.py | High |
| GET /exchange/supported | backend/app.py | High |
| GET /market/feed/status | backend/app.py | High |
| WS /stream | backend/app.py | High |
| GET /config/snapshot | backend/app.py | High |
| GET /runtime/status | backend/app.py | High |
| GET /version | backend/app.py | Medium |
| POST /exchange/test-connection | backend/app.py | High |
| config_snapshot_hash in DecisionTrace | backend/models/decision_trace.py | High |
| HOLD decision tracing | backend/engine/coordinator.py | High |
| src/lib/apiClient.ts | Frontend | Medium |
| src/lib/streamClient.ts | Frontend | Medium |
| src/hooks/useStream.ts + useExchangeStatus.ts | Frontend | Medium |
| 5x required UI components | Frontend | Medium |
| 8x required frontend routes | Frontend | Medium |
| Public landing at / | Frontend | Medium |
| WS reconnect backoff + status | Frontend | Medium |
| 11x required docs | Root | High |

---

## 5. Dead Code

- backend/adapters/brokers/ — MT5 broker adapter. Not wired into app. Dead.
- backend/engine/{broker_normalizer,execution_router,gateway_service,routing,signal_override,state_machine,venue_registry,withdrawal_manager}.py — Not wired into main app.
- backend/services/mt5_bridge/ — Not started in lifespan. Dead.
- backend/services/prediction_bot/ — Not started in lifespan. Dead.
- supabase/functions/ — Edge functions (ai-insights, crypto-prices). Frontend migrated away. Orphaned.
- backend/models/broker_models.py, backend/db/models/broker_tables.py, backend/db/repositories/broker_repos.py — Not used in paper-only flow.

---

## 6. Duplicate Code

- Two fetch wrappers: src/lib/api.ts + src/lib/backend.ts — overlapping HTTP logic. Should be unified into src/lib/apiClient.ts.
- Signal fetch: useSignalEngine.ts and useAIInsights.ts both independently fetch signal data.
- Auth context split: 4 auth-related files (AuthContext.ts, AuthProvider.tsx, AuthContextStore.ts, AuthBannerContextStore.ts) with unclear separation.

---

## 7. Security Gaps

| Gap | Severity | Detail |
|-----|---------|--------|
| operatorAuth.ts stores API key in localStorage | High | Readable by any JS on the page. XSS risk. Brief prohibits frontend exchange keys. |
| /intent/live no 403 outside paper mode | High | If TRADING_MODE=live, real orders can route through. Brief requires 403. |
| Kill switch unauthenticated without BACKEND_API_KEY | Medium | Deployment without the env var leaves kill-switch open. |
| POST /withdraw not explicitly disabled | Medium | Works in paper mode; should return 403 with "withdrawals_disabled" reason. |
| ALLOW_MAINNET can unlock live trading | High | Single env var flip enables real-money execution. Needs additional guard. |

---

## 8. Exchange Connectivity Status

| Exchange | Public Market Data | Auth Scaffolded | Live Orders | Adapter File | Status |
|---------|-------------------|----------------|------------|-------------|--------|
| Binance | OK (Binance.US OHLCV) | OK | BLOCKED (MainnetGate) | binance.py + binance_us_ohlcv.py | Working |
| Bitget | OK (REST public) | OK (HMAC) | BLOCKED | bitget.py | Working |
| BTCC | OK (REST public) | OK (HMAC) | BLOCKED | btcc.py | Working |
| CoinGecko | OK (primary feed, 15s cache) | N/A | N/A | coingecko.py | Working |
| Coinbase | MISSING | MISSING | MISSING | DOES NOT EXIST | NOT IMPLEMENTED |
| Live adapter | N/A | N/A | Must raise NotImplementedError | live.py MISSING | NOT IMPLEMENTED |

---

## 9. Missing Tests

| Test | Status |
|------|--------|
| Coinbase adapter contract | Missing |
| Live adapter (cannot place orders) | Missing |
| Replay determinism | Missing |
| Reconciliation drift | Missing |
| Frontend route smoke tests | Minimal (1 file) |
| Dashboard render | Missing |
| Auth guard | Missing |
| Mocked WS reconnect | Missing |
| /exchange/supported contract | Missing |
| /market/feed/status contract | Missing |
| Safe-mode fallback | Missing |
| HOLD decision trace | Missing |
| Config snapshot hash | Missing |

---

## 10. Missing Docs

| Document | Status |
|---------|--------|
| ARCHITECTURE_AUDIT.md | This file |
| REMEDIATION_PLAN.md | Created alongside |
| BACKEND_STRUCTURE.md | Missing |
| FRONTEND_STRUCTURE.md | Missing |
| API_CONTRACTS.md | Missing |
| EXCHANGE_CONNECTIVITY.md | Missing |
| DECISION_TRACE_SPEC.md | Missing |
| OBSERVABILITY.md | Missing |
| RUNBOOK_LOCAL.md | Missing |
| RUNBOOK_PRODUCTION.md | Missing |
| FINAL_CHANGELOG.md | Missing |

---

## 11. Current Test Baseline

323 tests collected | 320 passed | 3 skipped | 0 failures | 4 warnings (httpx deprecation)

Test coverage is solid for existing backend logic. All gaps are in net-new functionality required by the brief.
