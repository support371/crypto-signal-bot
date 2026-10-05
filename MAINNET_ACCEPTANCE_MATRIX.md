# Mainnet Completion — Acceptance Matrix (Corrected)

**Date:** 2026-09-29
**Status:** DRAFT — uncommitted, not merged, not deployed
**Baseline:** Extracted working copy (no .git); canonical main SHA `b3e78f1a` observed before draft work

This matrix replaces the earlier version that overstated completion. Each item is
marked with its true state. "Implemented" means code exists in the draft.
"Tested" means automated tests pass. "Production-wired" means merged, deployed,
and verified in production. Most items are NOT production-wired.

## Safety Invariants (Preserved)

| Item | State |
|------|-------|
| `TRADING_MODE=paper` default | ✅ Preserved |
| `EXCHANGE_MODE=paper` default | ✅ Preserved |
| `NETWORK=testnet` default | ✅ Preserved |
| `ALLOW_MAINNET=false` default | ✅ Preserved |
| No real-money order executed | ✅ Confirmed — zero trades |
| No paper trade created for demo | ✅ Confirmed |
| Existing $10K paper portfolio untouched | ✅ Confirmed |
| Live/withdraw routes still 403 in `index.ts` | ✅ Preserved |

## Implementation Status by Component

### 1. Exchange Adapters

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| Bitget adapter (V2 API) | ✅ Draft | ⚠️ Partial | ❌ No | Official docs verified; HMAC→Base64, query signing, endpoints corrected. NOT tested against demo credentials. **DEAD for UTA accounts:** Bitget docs state UTA API keys cannot access Classic endpoints — Gem's account is UTA, so V2 is superseded by the V3 adapter below. |
| Bitget adapter (V3/UTA API, read-only) | ✅ Implemented | ✅ 38/38 | ❌ No | Step-1 (2026-10-05): GET-only V3 client — account/assets, account/settings, funding-assets, current-position, market/instruments. Origin-pinned to api.bitget.com. Signing scheme verified byte-for-byte against UTA docs (reuses V2 signer; docs known-answer test). Mock-fixture certification PASSED (evidence persisted). Zero write code paths exist in the module. |
| BTCC adapter | ✅ Draft (refusing) | ✅ Unit | ❌ No | **EXTERNALLY BLOCKED:** BTCC has no public REST trading API docs. CCXT doesn't list BTCC. Adapter honestly refuses with `PROVIDER_NOT_DOCUMENTED`. Consistent with existing `btcc/contract.ts` (`candidateExecutionEnabled: false`). |
| Mock provider | ✅ | ✅ 38/38 | ❌ N/A | Certification harness only |

### 2. Execution Engine

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| Request validation | ✅ Draft | ✅ | ❌ No | Symbol, quantity, price, idempotency key |
| Idempotent submission | ✅ Draft | ✅ 38/38 | ❌ No | Reserve-first claim; concurrent duplicates → single execution |
| Timeout → RECOVERY_REQUIRED | ✅ Draft | ✅ | ❌ No | No blind retry on ambiguous result |
| State machine | ✅ Draft | ✅ | ❌ No | REQUESTED→SUBMITTED→ACK→FILL states |
| Reservation consume/release | ✅ Draft | ⚠️ Partial | ❌ No | **BUG:** consumes reservation using filled base qty (wrong unit — should be quote notional). Must fix. |

### 3. Gates & Authorization

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| Activation gates | ✅ Draft | ✅ | ❌ No | ALLOW_MAINNET, LIVE_TRADING_ENABLED, auth, roles |
| Account eligibility | ✅ Draft | ⚠️ Partial | ❌ No | Checks `live_exchange_accounts` row; schema unverified |
| Guardian integration | ⚠️ Partial | ❌ No | ❌ No | **DEBT:** Uses caller boolean, not authoritative `risk-engine.ts`. Must integrate. |
| RBAC roles | ✅ Draft | ⚠️ Partial | ❌ No | **DEBT:** Caller passes roles; not derived from persisted authz. Must use `authorization.ts`. |
| Step-up auth | ✅ Draft | ❌ No | ❌ No | Route requires header + D1 session; hash validation unverified |
| Circuit breakers | ⚠️ Partial | ❌ No | ❌ No | **DEBT:** No breaker row = healthy (fail-open). Must fail closed. |

### 4. Market Data

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| Fresh price feed | ✅ Draft | ⚠️ Partial | ❌ No | Bitget ticker + Coinbase cross-check (0.5% max deviation) |
| BTCC native price | ❌ No | ❌ No | ❌ No | **BLOCKED:** No BTCC API docs |
| Stale rejection | ✅ Draft | ✅ | ❌ No | Refuses to execute on stale/unavailable |
| Product normalization | ❌ No | ❌ No | ❌ No | **MISSING:** Tick/lot sizes, min notional per provider |

### 5. HTTP Route

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| `POST /intent/live` | ✅ Draft | ❌ No | ❌ No | **MUST NOT DEPLOY** in current state. Gated but incomplete. |

### 6. Reconciliation & Recovery

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| Reconciliation by order ID | ⚠️ Partial | ⚠️ Partial | ❌ No | Engine has `reconcileOrder`; no cron, no restart recovery |
| Restart recovery | ❌ No | ❌ No | ❌ No | **MISSING** |
| Partial fills | ⚠️ Partial | ✅ mock | ❌ No | Mock-tested; provider fill-history unverified |
| Cancellation | ✅ Draft | ❌ No | ❌ No | Adapter methods exist; not tested |

### 7. Accounting & Observability

| Component | Implemented | Tested | Production-Wired | Notes |
|-----------|-------------|--------|------------------|-------|
| Double-entry accounting | ❌ No | ❌ No | ❌ No | **MISSING** |
| Balances/positions | ❌ No | ❌ No | ❌ No | **MISSING** |
| Fees/P&L | ❌ No | ❌ No | ❌ No | **MISSING** |
| Audit receipts | ⚠️ Partial | ❌ No | ❌ No | Limited `audit_trail` event in route; not full chain |
| Realtime status | ❌ No | ❌ No | ❌ No | **MISSING** |

## Architectural Debt (Must Resolve Before Merge)

1. **D1 direct writes:** Engine writes `live_orders` directly to D1. AGENTS.md requires
   per-portfolio Durable Object as sole hot-state writer. D1 is projection/read store.
2. **Risk engine bypass:** Gate evaluator uses caller-computed booleans. Must integrate
   existing `worker/src/live/risk-engine.ts` (sole allocation authority).
3. **Authorization duplication:** Must use existing `worker/src/live/authorization.ts`
   instead of parallel role checks.
4. **Domain duplication:** New `execution/` directory parallels existing `live/` domain
   (guardian, reconciliation, fill-accounting, order-state-machine). Must integrate.
5. **Reservation unit bug:** Consume uses base qty; must use quote notional consistently.
6. **Fail-open breakers:** Missing breaker row treated as healthy; must fail closed.
7. **Migration 033:** Assumes `live_orders` exists; not tested against real schema.

## Verification Evidence (This Draft)

| Check | Result |
|-------|--------|
| Worker `tsc --noEmit` | ✅ Clean |
| Frontend `tsc --noEmit` | ✅ Clean |
| Vitest (worker) | ✅ 38/38 pass |
| `verify:paper-safety` | ✅ Pass |
| `verify:migrations` | ✅ Pass (29 files) |
| Secret scan (source) | ✅ No hardcoded secrets |
| Live Node tests (75 `live-*.test.ts`) | ❌ Not run |
| Frontend build/tests | ❌ Not run |
| Migration 033 test | ❌ Not run |
| Demo credential test (Bitget) | ❌ Not run (no creds) |
| Authenticated E2E | ❌ Blocked (no session) |

## What "Complete" Requires

Per AGENTS.md and Gem's mandate, completion requires ALL of:
1. ✅ Implemented (draft) — DONE for listed components
2. ✅ Tested — PARTIAL (38/38 unit; missing integration/E2E)
3. ❌ Production-wired — NOT DONE (not merged, not deployed)
4. ❌ Architectural integration — NOT DONE (debt items above)
5. ❌ External blockers resolved — NOT DONE (BTCC API)
6. ✅ Intentionally inactive — DONE (all flags default false, zero trades)

**Verdict:** This is a tested draft implementation, NOT a production completion.
Do not merge or deploy until architectural debt is resolved and Gem explicitly
authorizes activation as a separate decision.
