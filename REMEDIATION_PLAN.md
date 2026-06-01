# REMEDIATION_PLAN.md
**Project:** support371/crypto-signal-bot
**Date:** 2026-06-01
**Auditor:** Base44 Super Agent Developer
**Based on:** ARCHITECTURE_AUDIT.md

No implementation begins before this file is committed.

---

## Priority Tiers

- P0 = Security / data integrity / correctness blocking production trust
- P1 = Required by acceptance checklist
- P2 = Required by brief but not blocking immediate safety
- P3 = Quality, polish, observability

---

## Phase 2 — Backend: Critical Safety Fixes
**Effort:** Small | **Risk:** Low (additive only) | **Tests:** Yes

### Items
1. **[P0] Add `live.py` adapter** — `backend/adapters/exchanges/live.py`
   - Raises `NotImplementedError` on every method.
   - Test: `tests/adapters/test_live_adapter.py` — proves it cannot place orders.

2. **[P0] Disable `POST /withdraw` explicitly**
   - Return `403 {"mode": "safe", "reason": "withdrawals_disabled"}` unconditionally.
   - Auth gate remains for any future re-enable path.

3. **[P0] Add 403 guard to `/intent/live`**
   - If `TRADING_MODE != "live"`, return `403 {"mode": "safe", "reason": "paper_mode_only"}`.
   - Do not remove MainnetGate — keep as second line of defence.

4. **[P0] Remove `operatorAuth.ts` localStorage key storage**
   - Delete `writeOperatorApiKey` / `readOperatorApiKey` calls from frontend.
   - Replace with session-scoped state only (React context, never persisted).
   - Files: `src/lib/operatorAuth.ts`, `src/lib/backend.ts`, `src/components/dashboard/SettingsModal.tsx`.

**Files touched:** `backend/adapters/exchanges/live.py` (new), `backend/app.py`, `src/lib/operatorAuth.ts`, `src/lib/backend.ts`, `src/components/dashboard/SettingsModal.tsx`, `tests/adapters/test_live_adapter.py` (new)

---

## Phase 3 — Backend: Exchange Connectivity as First-Class
**Effort:** Medium | **Risk:** Low (additive) | **Tests:** Yes

### Items
1. **[P1] Add Coinbase adapter** — `backend/adapters/exchanges/coinbase.py`
   - Public market data only (REST ticker, OHLCV).
   - Authenticated actions disabled by default.
   - Live orders raise `NotImplementedError`.
   - Test: `tests/adapters/test_coinbase.py`.

2. **[P1] Add `GET /exchange/supported`** — support matrix endpoint
   - Returns JSON per brief spec for Binance, Bitget, BTCC, Coinbase.
   - `live_execution_enabled: false` for all.

3. **[P1] Add `GET /market/feed/status`**
   - Returns source, symbol_count, connected, stale, last_tick_at, latency_ms, fallback_active.

4. **[P1] Add `POST /exchange/test-connection`**
   - Diagnostic only. No real orders. No secret exposure.
   - Tests connectivity for Binance, Bitget, BTCC, Coinbase public APIs.
   - Returns feed/connectivity state.

**Files touched:** `backend/adapters/exchanges/coinbase.py` (new), `backend/app.py`, `tests/adapters/test_coinbase.py` (new), `tests/routes/test_exchange_endpoints.py` (new)

---

## Phase 4 — Backend: API Contract Completion
**Effort:** Small | **Risk:** Low (additive) | **Tests:** Yes

### Items
1. **[P1] `GET /version`** — return app version, git sha, runtime info.
2. **[P1] `GET /runtime/status`** — uptime, safe mode, selected exchange, feed state, WS client count.
3. **[P1] `GET /config/snapshot`** — config without secrets. Include config_hash.
4. **[P1] Move hardcoded thresholds to config** — 0.65/0.75 confidence, conf_mult, starting_nav.
   - Add to `config.yaml` under `signal:` and `portfolio:` sections.
   - Remove hardcoded literals from `logic/signals.py`, `logic/risk.py`, `logic/context.py`, `logic/strategies.py`.

5. **[P1] Add `config_snapshot_hash` to `DecisionTrace` model.**
6. **[P1] Trace HOLD decisions** — emit a `DecisionTrace` with `decision=HOLD` when signal confidence is below threshold or risk blocks.

**Files touched:** `backend/app.py`, `backend/config/config.yaml`, `backend/logic/signals.py`, `backend/logic/risk.py`, `backend/logic/context.py`, `backend/logic/strategies.py`, `backend/models/decision_trace.py`, `backend/engine/coordinator.py`

---

## Phase 5 — Backend: WS /stream + Typed Events
**Effort:** Medium | **Risk:** Medium (new WS route alongside existing) | **Tests:** Yes

### Items
1. **[P1] Add `WS /stream`** — canonical WebSocket endpoint.
   - Backward-compatible with existing `/ws` and `/ws/updates`.
   - Event types: tick, signal, risk, fill, nav, health, safe_mode, exchange_status, guardian, heartbeat.
   - Every event has: type, event_id (uuid), trace_id, timestamp, payload.
   - Heartbeat every 15–30 seconds.
   - Broadcasts: safe-mode changes, exchange degradation, Guardian blocks.

2. **[P2] Mocked WS reconnect test** — `tests/services/test_ws_reconnect.py`.

**Files touched:** `backend/app.py`, `backend/services/websocket_manager.py`, `tests/services/test_ws_reconnect.py` (new)

---

## Phase 6 — Backend: Replay System
**Effort:** Large | **Risk:** Medium | **Tests:** Yes

### Items
1. **[P1] Create `backend/replay/`**
   - `backend/replay/__init__.py`
   - `backend/replay/replayer.py` — accepts audit log + config, reconstructs PortfolioState.
   - Must produce same final cash, positions, NAV, realized PnL, unrealized PnL, max drawdown, trace count, config hash.

2. **[P1] `tests/test_replay_determinism.py`**
   - Seeds known trace log → runs replay → asserts exact match.
   - Test MUST fail if replay output changes unexpectedly.

**Files touched:** `backend/replay/__init__.py` (new), `backend/replay/replayer.py` (new), `tests/test_replay_determinism.py` (new)

---

## Phase 7 — Backend: Reconciliation Drift Test
**Effort:** Small | **Risk:** Low | **Tests:** Yes

### Items
1. **[P1] `tests/test_reconciliation_drift.py`**
   - Creates known fills + positions → runs reconciliation → asserts no drift.
   - Injects artificial drift → asserts drift detected.
   - Uses existing `backend/services/reconciliation/service.py`.

**Files touched:** `tests/test_reconciliation_drift.py` (new)

---

## Phase 8 — Frontend: Route Completion + Public Landing
**Effort:** Large | **Risk:** Medium | **Tests:** Yes

### Items
1. **[P1] Make `/` a public landing page**
   - Remove `ProtectedRoute` wrapper from `/`.
   - `PublicHome.tsx` becomes the landing page component at `/`.

2. **[P1] Add all required routes to `App.tsx`**
   - `/dashboard` — protected, main dashboard (move current Index.tsx here)
   - `/positions` — protected
   - `/portfolio` — protected
   - `/guardian` — protected
   - `/audit` — protected
   - `/health` — protected
   - `/settings` — protected
   - `/reset-password` — public

3. **[P1] Create page stubs** — placeholder pages for each new route (render without NotFound).

4. **[P2] Fix "Base44 Managed Auth" wording** — Replace "Supabase" in user-facing copy.

**Files touched:** `src/App.tsx`, `src/pages/PublicHome.tsx`, `src/pages/Dashboard.tsx` (new or rename Index.tsx), `src/pages/Positions.tsx` (new), `src/pages/Portfolio.tsx` (new), `src/pages/Guardian.tsx` (new), `src/pages/Audit.tsx` (new), `src/pages/Health.tsx` (new), `src/pages/Settings.tsx` (new), `src/pages/ResetPassword.tsx` (new), `src/pages/Auth.tsx`

---

## Phase 9 — Frontend: Data Layer Consolidation
**Effort:** Medium | **Risk:** Medium | **Tests:** Yes

### Items
1. **[P1] Create `src/lib/apiClient.ts`** — single typed HTTP client.
   - Retry logic: exponential backoff with jitter for 5xx + network failures.
   - No retry on 401/403.
   - Auth failures handled globally.
   - Safe-mode responses typed.

2. **[P1] Create `src/lib/streamClient.ts`** — canonical WebSocket client.
   - Connects to `/stream`.
   - Reconnect with exponential backoff: 1s → 2s → 5s → 10s → 20s → max 30s + jitter.
   - Tracks: connected, connecting, reconnectAttempt, nextRetryMs, lastConnectedAt, lastDisconnectedAt, lastMessageAt, status.
   - Status values: connecting, connected, waking, reconnecting, degraded, offline.

3. **[P1] Create `src/hooks/useStream.ts`** — hook wrapping streamClient.
4. **[P1] Create `src/hooks/useExchangeStatus.ts`** — calls GET /exchange/status.
5. **[P1] Migrate `useAIInsights.ts` and `useCryptoPrices.ts`** to use apiClient (no direct fetch()).
6. **[P2] Remove duplicate fetch logic** from api.ts and backend.ts — consolidate into apiClient.ts.

**Files touched:** `src/lib/apiClient.ts` (new), `src/lib/streamClient.ts` (new), `src/hooks/useStream.ts` (new), `src/hooks/useExchangeStatus.ts` (new), `src/hooks/useAIInsights.ts`, `src/hooks/useCryptoPrices.ts`, `src/lib/api.ts`, `src/lib/backend.ts`

---

## Phase 10 — Frontend: Required UI Components
**Effort:** Medium | **Risk:** Low | **Tests:** Yes

### Items
1. **[P1] `src/components/SystemStatusBanner.tsx`** — shows backend/WS/exchange status as a top banner.
2. **[P1] `src/components/SafeModePanel.tsx`** — shows safe mode active state with reason.
3. **[P1] `src/components/ExchangeStatusCard.tsx`** — shows selected exchange, feed state, stale warning.
4. **[P1] `src/components/BackendStatusCard.tsx`** — shows backend uptime, mode, network.
5. **[P1] `src/components/GuardianBlockList.tsx`** — shows active Guardian blocks with reasons.

**Files touched:** 5 new component files

---

## Phase 11 — Documentation
**Effort:** Medium | **Risk:** None | **Tests:** N/A

### Items (all new files)
1. BACKEND_STRUCTURE.md
2. FRONTEND_STRUCTURE.md
3. API_CONTRACTS.md
4. EXCHANGE_CONNECTIVITY.md — must include Binance, Bitget, BTCC, Coinbase
5. DECISION_TRACE_SPEC.md
6. OBSERVABILITY.md
7. RUNBOOK_LOCAL.md
8. RUNBOOK_PRODUCTION.md
9. FINAL_CHANGELOG.md

---

## Phase 12 — Final Test Gate + Smoke Checks
**Effort:** Medium | **Risk:** Low | **Tests:** All

### Items
1. Run full test suite — all must pass.
2. Vercel production smoke test — hit all routes.
3. Render backend health smoke test — hit /health, /ready, /exchange/supported.
4. 10-minute WebSocket soak test — connect to /stream, verify no disconnect.
5. Auth guard test — unauthenticated user redirected from protected routes.
6. Dashboard render test — no console errors on first load.

---

## Effort Estimates

| Phase | Effort | Estimated Commits |
|-------|--------|-----------------|
| 2 — Critical Safety | Small | 3–4 |
| 3 — Exchange Connectivity | Medium | 3–4 |
| 4 — API Contract | Small | 2–3 |
| 5 — WS /stream | Medium | 2 |
| 6 — Replay System | Large | 3–4 |
| 7 — Reconciliation Test | Small | 1 |
| 8 — Frontend Routes | Large | 4–5 |
| 9 — Data Layer | Medium | 3 |
| 10 — UI Components | Medium | 2–3 |
| 11 — Documentation | Medium | 1–2 |
| 12 — Final Gate | Small | 1 |

---

## Risk Notes

- Replay system (Phase 6) is the highest-risk new module. It must not touch existing audit store logic — read-only access only.
- Frontend route refactor (Phase 8) risks breaking the existing working dashboard. The current Index.tsx should be moved (not rewritten) to Dashboard.tsx.
- Removing localStorage key storage (Phase 2) will break existing operator sessions. Users will need to re-authenticate to any operator-gated features. This is the correct security behaviour.
- WS /stream (Phase 5) must not remove /ws or /ws/updates until frontend is fully migrated.
- SQLite on Render free tier remains ephemeral. This is a known limitation — documented in RUNBOOK_PRODUCTION.md; no code fix for this phase.

---

## Files Likely Touched (Summary)

Backend:
- backend/adapters/exchanges/coinbase.py (new)
- backend/adapters/exchanges/live.py (new)
- backend/replay/__init__.py (new)
- backend/replay/replayer.py (new)
- backend/app.py (multiple endpoints added)
- backend/config/config.yaml (thresholds moved here)
- backend/models/decision_trace.py (config_snapshot_hash added)
- backend/engine/coordinator.py (HOLD tracing)
- backend/logic/signals.py, risk.py, context.py, strategies.py (de-hardcode)
- backend/services/websocket_manager.py (/stream support)

Frontend:
- src/App.tsx (routes)
- src/pages/* (8 new pages)
- src/lib/apiClient.ts (new)
- src/lib/streamClient.ts (new)
- src/lib/operatorAuth.ts (localStorage removal)
- src/hooks/useStream.ts (new)
- src/hooks/useExchangeStatus.ts (new)
- src/hooks/useAIInsights.ts (migrated to apiClient)
- src/hooks/useCryptoPrices.ts (migrated to apiClient)
- src/components/SystemStatusBanner.tsx (new)
- src/components/SafeModePanel.tsx (new)
- src/components/ExchangeStatusCard.tsx (new)
- src/components/BackendStatusCard.tsx (new)
- src/components/GuardianBlockList.tsx (new)

Tests:
- tests/adapters/test_live_adapter.py (new)
- tests/adapters/test_coinbase.py (new)
- tests/routes/test_exchange_endpoints.py (new)
- tests/test_replay_determinism.py (new)
- tests/test_reconciliation_drift.py (new)

Docs:
- 9 new markdown files

---

## Test Plan Per Phase

| Phase | Tests Required |
|-------|--------------|
| 2 | test_live_adapter.py, test_withdraw_disabled.py, test_intent_live_403.py |
| 3 | test_coinbase.py, test_exchange_endpoints.py |
| 4 | test_config_snapshot.py, test_hold_trace.py |
| 5 | test_ws_reconnect.py, test_stream_events.py |
| 6 | test_replay_determinism.py |
| 7 | test_reconciliation_drift.py |
| 8 | frontend route smoke (Playwright or vitest) |
| 9 | apiClient unit tests |
| 10 | component render tests |
| 11 | N/A |
| 12 | Full suite + smoke checks |
