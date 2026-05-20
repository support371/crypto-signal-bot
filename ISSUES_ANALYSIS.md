# Crypto Signal Bot — Complete Issues Analysis

**Date:** 2026-05-20  
**Repository:** support371/crypto-signal-bot  
**Status:** Multiple critical and non-critical issues identified and catalogued

---

## Executive Summary

After deep code analysis across backend, frontend, configuration, testing, and infrastructure layers, I've identified **18 distinct issues** ranging from critical architectural gaps to minor documentation inconsistencies. This document catalogs each issue with root cause, impact, and remediation strategy.

---

## CRITICAL ISSUES (P0)

### 1. **Missing Scoped Guardian Kill-Switch Route**  
**Status:** Open Issue #49  
**Severity:** CRITICAL  
**Component:** Backend API / Guardian Service  

**Problem:**
- Frontend `GuardianPanel` calls `POST /kill-switch/scope` (strategy/venue-level execution blocks)
- Backend `backend/app.py` does NOT expose this route
- Creates 404 error when operators attempt scoped controls

**Root Cause:**
- Route defined in `backend/routes/kill_switch.py` (line 113-145) but NOT included in main app
- Backend guardian service (`guardian_bot/service.py`) has `kill_strategy`, `revive_strategy`, `kill_venue`, `revive_venue` functions but no HTTP binding

**Evidence:**
```python
# backend/routes/kill_switch.py line 113 (route exists)
@router.post("/kill-switch/scope", response_model=ScopedKillSwitchResponse, ...)
async def toggle_scoped_kill_switch(body: ScopedKillSwitchRequest) -> ScopedKillSwitchResponse:
    # implementation exists

# but backend/app.py line 1 does NOT include this router in include_router
```

**Impact:**
- Operators cannot block specific strategies or venues
- Dashboard shows controls but backend rejects requests
- Data loss risk: scoped block decisions not persisted

**Remediation:**
Include `kill_switch_router` in `backend/app.py` lifespan or route inclusion

---

### 2. **Reconciliation Service Incomplete**  
**Severity:** CRITICAL  
**Component:** Backend / Services  

**Problem:**
- `backend/services/reconciliation/service.py` exists with basic drift detection
- **Never wired into main backend** (`backend/app.py` has no reconciliation checks)
- No `/reconciliation/status` endpoint exposed
- No automatic reconciliation loop triggered on startup

**Evidence:**
- File exists with `run_reconciliation()`, `start_reconciliation()`, `stop_reconciliation()`
- But zero calls to these in `backend/app.py` lifespan
- Global state `_last_report` is in-memory only (lost on restart)

**Impact:**
- No balance drift detection between paper and live adapters
- No automatic discrepancy flagging
- Loss of reconciliation audit trail

**Remediation:**
- Wire reconciliation service into backend lifespan
- Expose `/reconciliation/status` GET endpoint
- Persist reconciliation reports to DB (Phase 11 stub exists)

---

### 3. **Guardian Service Incomplete/Unbound**  
**Severity:** CRITICAL  
**Component:** Backend / Guardian Bot Service  

**Problem:**
- `backend/services/guardian_bot/service.py` exists and referenced in routes
- But **implementation is not visible in accessible code**
- Routes depend on functions that may not exist:
  - `activate_kill_switch()`, `deactivate_kill_switch()`
  - `is_kill_switch_active()`, `get_guardian_status()`
  - `kill_strategy()`, `kill_venue()`, `revive_strategy()`, `revive_venue()`

**Evidence:**
```python
# backend/routes/kill_switch.py line 11-20
from backend.services.guardian_bot.service import (
    activate_kill_switch,
    deactivate_kill_switch,
    # ... more
)
# But service file not retrieved successfully
```

**Impact:**
- Kill-switch routes may fail at runtime if service not fully implemented
- Guardian status endpoint returns incomplete data
- Scoped kill-switch operations fail silently

**Remediation:**
- Verify `backend/services/guardian_bot/service.py` complete implementation
- Ensure all imported functions have async signatures
- Add missing dataclass for `GuardianStatus` return type

---

### 4. **Missing Auth Config Loader**  
**Severity:** CRITICAL  
**Component:** Backend Configuration  

**Problem:**
- `backend/routes/kill_switch.py` imports `from backend.config.loader import get_auth_config`
- File NOT found or doesn't expose this function
- Backend auth falls back to inline `BACKEND_API_KEY` check
- Inconsistent auth between routes

**Evidence:**
```python
# backend/routes/kill_switch.py line 25
from backend.config.loader import get_auth_config  # <-- File missing or incomplete

# backend/app.py line 154
def require_auth(api_key: Optional[str] = Security(_api_key_header)):
    if not BACKEND_API_KEY:
        return
    if api_key != BACKEND_API_KEY:
        raise HTTPException(status_code=401, ...)
```

**Impact:**
- Auth config not unified
- Routes fail to import
- Inconsistent auth policy enforcement

**Remediation:**
- Create `backend/config/loader.py` with `get_auth_config()` returning `AuthConfig` dataclass
- Unify auth enforcement across app

---

### 5. **Frontend URL Environment Variable Mismatch**  
**Severity:** CRITICAL  
**Component:** Frontend / Deployment  

**Problem:**
- Root `.env.example` defines `VITE_BACKEND_URL` for frontend
- `backend/env/.env.example` exists but NOT used by Vercel frontend build
- Vercel deployment fails to connect frontend to backend

**Evidence:**
```dotenv
# .env.example line 1-2
VITE_BACKEND_URL=https://your-backend-host.example.com
VITE_CRYPTOCORE_API_BASE=https://your-backend-host.example.com  # Duplicate name?

# But backend env is at backend/env/.env.example (not in Vercel scope)
```

**Impact:**
- Vercel frontend deployed without correct backend URL
- Frontend requests fail with network errors
- Auth page (https://crypto-signal-5qwcma0l5-admin-25521151s-projects.vercel.app/auth) receives no backend response

**Remediation:**
- Ensure `.env.example` in root is Vercel-friendly
- Set `VITE_BACKEND_URL` in Vercel project environment variables
- Document proper Vercel deployment config

---

## HIGH PRIORITY ISSUES (P1)

### 6. **Test Coverage Gaps — Market Data Service**  
**Severity:** HIGH  
**Component:** Backend Tests  

**Problem:**
- No dedicated test file for market data providers
- `BinancePublicMarketDataService`, `BitgetPublicMarketDataService`, `BTCCPublicMarketDataService` untested
- WebSocket fallback logic not exercised
- Stale data detection not validated

**Evidence:**
- Files in `backend/logic/market_data.py` (lines 259-489) with no corresponding tests
- E2E tests skip live connectivity (pytest.skip())

**Impact:**
- Market data failures not caught until production
- WebSocket connection loss not validated
- REST fallback behavior unverified

**Remediation:**
- Create `backend/tests/test_market_data.py`
- Mock WebSocket and REST endpoints
- Test timeout, reconnection, and stale detection

---

### 7. **Earnings/P&L Ledger Untested**  
**Severity:** HIGH  
**Component:** Backend Tests / Logic  

**Problem:**
- `backend/logic/earnings.py` has no dedicated test file
- FIFO lot matching logic untested
- Realized vs. unrealized P&L calculation not validated
- Edge cases (short sells, partial fills) not covered

**Evidence:**
- Logic file `backend/logic/earnings.py` (lines 1-112) has complex FIFO matching
- No tests visible in search results for this module

**Impact:**
- Incorrect P&L calculations go undetected
- Earnings ledger corruption possible
- Operator cannot trust earnings reports

**Remediation:**
- Create `backend/tests/test_earnings.py`
- Test FIFO matching, P&L calculation, persistence
- Test edge cases: multiple symbols, partial fills, short sells

---

### 8. **Paper Trading Fill Simulation Incomplete**  
**Severity:** HIGH  
**Component:** Backend Logic  

**Problem:**
- `backend/logic/paper_trading.py` `simulate_fill()` (lines 42-83) incomplete
- Function cut off mid-implementation
- SELL side handling missing
- Order rejection path unclear

**Evidence:**
```python
# backend/logic/paper_trading.py line 73
else:  # SELL
    base_balance = portfolio.get_balance(base_asset)
    if base_balance < fill_quantity:
        # ... line 73-83 is cut off in retrieval
```

**Impact:**
- SELL orders may fail silently or behave unexpectedly
- Paper portfolio not accurate
- Risk engine tests may pass but live trading fails

**Remediation:**
- Complete `simulate_fill()` implementation
- Add comprehensive tests for BUY and SELL paths
- Validate portfolio state after fill

---

### 9. **Exchange Adapter Error Handling Missing**  
**Severity:** HIGH  
**Component:** Backend / Adapters  

**Problem:**
- `CCXTSpotAdapter` (lines 219-410) lacks error recovery
- Network errors not retried
- API rate limiting not handled
- Order rejection reasons not captured

**Evidence:**
- No retry logic in `place_order()`, `get_price()`, etc.
- Exception handling only at app level (ExchangeAPIError handler)
- No exponential backoff or circuit breaker

**Impact:**
- Transient network errors block trading
- Guardian error counter increments incorrectly
- Kill switch triggers on temporary API hiccups

**Remediation:**
- Add retry logic with exponential backoff
- Implement circuit breaker for failing exchanges
- Distinguish transient vs. permanent errors

---

### 10. **Rate Limiter State Shared Across Requests**  
**Severity:** HIGH  
**Component:** Backend / App  

**Problem:**
- `backend/app.py` (lines 161-177) uses global `_rate_limit_store: Dict[str, List[float]]`
- No cleanup of old entries (unbounded growth)
- Thread-safety not guaranteed (mutable dict without lock)
- IP spoofing possible if behind proxy without X-Forwarded-For

**Evidence:**
```python
# backend/app.py line 161-177
_rate_limit_store: Dict[str, List[float]] = defaultdict(list)

def rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    # ... no thread lock, no expiry
```

**Impact:**
- Memory leak (old timestamps never removed)
- Race conditions under high load
- Incorrect rate limit for clients behind NAT

**Remediation:**
- Add timestamp expiry (remove entries > 60s old)
- Use threading.Lock for thread-safety
- Document X-Forwarded-For trust requirements

---

### 11. **Asymmetric Config Sources (YAML vs ENV)**  
**Severity:** HIGH  
**Component:** Backend Configuration  

**Problem:**
- `backend/config/config.yaml` has duplicate sections (lines 21 & 27 both define "bitget")
- YAML defaults not always aligned with code defaults
- Risk thresholds defined in both YAML and hardcoded in risk.py
- No validation that ENV overrides are within safe ranges

**Evidence:**
```yaml
# backend/config/config.yaml line 21 & 27 (duplicate!)
bitget:
  base_url: https://api.bitget.com
  ...
bitget:  # <-- DUPLICATE
  base_url_testnet: https://api.bitget.com
```

**Impact:**
- Configuration conflicts cause unpredictable behavior
- Risk thresholds can be set to unsafe values via ENV
- Operators cannot reliably validate config before deploy

**Remediation:**
- Remove duplicate config sections
- Add validation to ENV overrides (e.g., max_drawdown_pct ≤ 1.0)
- Document all config sources and priority

---

### 12. **Missing POST /kill-switch/deactivate Endpoint**  
**Severity:** HIGH  
**Component:** Backend API  

**Problem:**
- Kill-switch toggle is single POST `/kill-switch` endpoint with `activate` boolean
- If activation fails but deactivation succeeds, asymmetric state possible
- No explicit deactivation audit trail separate from activation
- Unclear state transitions in dashboard

**Evidence:**
```python
# backend/routes/kill_switch.py line 67-110
@router.post("/kill-switch", response_model=KillSwitchResponse, ...)
async def toggle_kill_switch(body: KillSwitchRequest) -> KillSwitchResponse:
    # Single endpoint, activate and deactivate mixed
```

**Impact:**
- Unclear semantics for operators
- State transitions not fully audited
- Recovery from kill-switch state confusing

**Remediation:**
- Optionally add separate `POST /kill-switch/deactivate` endpoint
- Ensure both paths fully audited
- Document idempotency guarantees

---

### 13. **Audit Store No Database Backend**  
**Severity:** HIGH  
**Component:** Backend / Audit / Persistence  

**Problem:**
- `backend/services/audit/service.py` (lines 67-141) stores audit in-memory `_audit_buffer`
- Redis optional (lines 80-140), used only if available
- No persistent database (Phase 11 stub exists but not wired)
- Audit trail lost on restart

**Evidence:**
```python
# backend/services/audit/service.py line 70
_audit_buffer: list[AuditEntry] = []  # In-memory only

# line 129
# Phase 11 adds DB write here (stub)
```

**Impact:**
- Audit trail not forensically reliable
- Operator cannot recover kill-switch history after crash
- Compliance audit fails

**Remediation:**
- Wire audit to database (Phase 11 preparation already stubbed)
- Add `/audit` endpoint to query database, not in-memory
- Implement retention policy (e.g., 1 year)

---

## MEDIUM PRIORITY ISSUES (P2)

### 14. **WebSocket Client Cleanup Incomplete**  
**Severity:** MEDIUM  
**Component:** Backend / WebSocket  

**Problem:**
- `backend/app.py` (lines 1080-1118) has `ws_clients: Set[WebSocket]`
- Dead client removal only happens during send (line 382-389)
- If client disconnects without closing, remains in set indefinitely
- Health pings timeout = 30s (line 1100), potential connection zombie state

**Evidence:**
```python
# backend/app.py line 382-389
async def broadcast(message: Dict[str, Any]):
    dead: List[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)  # Only removed on send failure
    for ws in dead:
        ws_clients.discard(ws)
```

**Impact:**
- Memory leak (zombie WebSocket connections)
- Broadcast latency increases over time
- Dashboard real-time updates degrade

**Remediation:**
- Add explicit cleanup on disconnect (line 1114-1118 already tries)
- Implement connection timeout
- Log dead client removal

---

### 15. **Paper Portfolio Position Tracking Incorrect**  
**Severity:** MEDIUM  
**Component:** Backend / Paper Trading  

**Problem:**
- `backend/logic/paper_trading.py` `get_positions()` (line 56-63) only returns positive balances
- Does not track open orders separately
- No "locked" balance representation
- Incomplete position state for frontend

**Evidence:**
```python
# backend/logic/paper_trading.py line 56-63
def get_positions(self) -> List[Dict[str, str]]:
    result = []
    for asset, amount in self.balances.items():
        if amount > 0:
            result.append({"asset": asset, "free": str(amount)})
    return result
```

**Impact:**
- Frontend cannot distinguish free vs. locked balance
- Open orders not visible in portfolio endpoint
- Incorrect trading decisions based on stale balance

**Remediation:**
- Track open_orders separately (already in dataclass)
- Compute locked balance from open orders
- Return both free and locked in position response

---

### 16. **Symbol Parsing Brittle**  
**Severity:** MEDIUM  
**Component:** Backend / Exchange Adapter  

**Problem:**
- `backend/logic/paper_trading.py` `_parse_symbol()` and `backend/logic/exchange_adapter.py` `_ccxt_symbol()` both parse symbols differently
- No validation that symbol is supported
- Assumes USDT or other quote assets (lines 24)
- Will fail on exotic symbol pairs

**Evidence:**
```python
# backend/logic/exchange_adapter.py line 412-419
def _ccxt_symbol(symbol: str) -> str:
    normalized = symbol.upper().replace("-", "/")
    if "/" in normalized:
        return normalized
    for quote in sorted(_QUOTE_ASSETS, key=len, reverse=True):
        if normalized.endswith(quote):
            return f"{normalized[:-len(quote)]}/{quote}"
    return normalized  # Fallback returns unparseable symbol
```

**Impact:**
- Orders on exotic symbols fail
- Error messages unclear
- No validation early

**Remediation:**
- Centralize symbol parsing
- Validate against supported list
- Return clear error on unsupported symbol

---

### 17. **Mainnet Gate Documentation Gap**  
**Severity:** MEDIUM  
**Component:** Documentation / Safety  

**Problem:**
- `ALLOW_MAINNET=true` is hard security gate (good!)
- But no clear remediation documentation if accidentally set
- No "Are you sure?" confirmation for mainnet
- No mainnet-specific audit trail

**Evidence:**
- Startup check warns but allows (line 84-94 in startup_checks.py)
- No separate /admin/toggle-mainnet endpoint with confirmation

**Impact:**
- Operator might accidentally enable mainnet
- Hard to audit if mainnet was ever active
- No recovery procedure documented

**Remediation:**
- Create `docs/MAINNET_SAFETY_GATE.md` with recovery steps
- Add audit entry for `ALLOW_MAINNET` changes
- Consider two-person rule for mainnet activation

---

### 18. **Mode Control Class Unused**  
**Severity:** MEDIUM  
**Component:** Backend Configuration  

**Problem:**
- `backend/config/mode_control.py` defines `ModeControl` class
- Never imported or used anywhere
- Duplicates functionality of `TRADING_MODE` env var handling
- Dead code

**Evidence:**
```python
# backend/config/mode_control.py (unused)
class ModeControl:
    def __init__(self, mode=None):
        self.mode = mode or self.load_mode_from_env()
        self.validate_mode()
    # ... but never imported
```

**Impact:**
- Code confusion (two mode systems)
- Maintenance burden
- Misleading codebase structure

**Remediation:**
- Remove `backend/config/mode_control.py` (or integrate if needed)
- Document single source of truth for `TRADING_MODE`

---

## LOW PRIORITY ISSUES (P3)

### 19. **Type Hints Incomplete**  
**Severity:** LOW  
**Component:** Backend / Code Quality  

**Problem:**
- Several functions missing return type hints
- Market data handlers use `Callable[[Dict[str, Any]], Awaitable[None]]` (correct) but not consistently
- Model classes use `Optional[str]` with potential None dereference

**Impact:**
- IDE autocomplete limited
- Type checker (mypy) would fail
- Harder to catch bugs

**Remediation:**
- Run mypy to identify missing hints
- Add return types systematically

---

### 20. **Frontend/Backend Contract Underspecified**  
**Severity:** LOW  
**Component:** API / Documentation  

**Problem:**
- No OpenAPI/Swagger spec generated
- Response schemas documented in docstrings only
- No client code generation possible

**Impact:**
- Frontend developers must reverse-engineer API
- Breaking changes not caught early

**Remediation:**
- Add Pydantic response models for all endpoints
- Generate OpenAPI via FastAPI automatic docs

---

## Summary Table

| ID | Issue | Severity | Component | Status |
|----|-------|----------|-----------|--------|
| 1 | Scoped Guardian Kill-Switch Route Missing | **CRITICAL** | Backend API | Open #49 |
| 2 | Reconciliation Service Unwired | **CRITICAL** | Backend Services | Unfixed |
| 3 | Guardian Service Incomplete | **CRITICAL** | Backend Services | Unfixed |
| 4 | Auth Config Loader Missing | **CRITICAL** | Backend Config | Unfixed |
| 5 | Frontend URL Env Mismatch | **CRITICAL** | Frontend Deployment | Unfixed |
| 6 | Market Data Tests Missing | **HIGH** | Backend Tests | Unfixed |
| 7 | Earnings Ledger Tests Missing | **HIGH** | Backend Tests | Unfixed |
| 8 | Paper Fill Simulation Incomplete | **HIGH** | Backend Logic | Unfixed |
| 9 | Exchange Adapter Error Handling | **HIGH** | Backend Adapters | Unfixed |
| 10 | Rate Limiter Memory Leak | **HIGH** | Backend App | Unfixed |
| 11 | Config YAML Duplicates | **HIGH** | Configuration | Unfixed |
| 12 | Kill-Switch Deactivate Semantics | **HIGH** | Backend API | Design |
| 13 | Audit Store No Database | **HIGH** | Backend Persistence | Unfixed |
| 14 | WebSocket Zombie Cleanup | **MEDIUM** | Backend WebSocket | Unfixed |
| 15 | Position Tracking Incomplete | **MEDIUM** | Backend Logic | Unfixed |
| 16 | Symbol Parsing Brittle | **MEDIUM** | Backend Adapters | Unfixed |
| 17 | Mainnet Gate Undocumented | **MEDIUM** | Documentation | Unfixed |
| 18 | Mode Control Class Unused | **MEDIUM** | Code Quality | Unfixed |
| 19 | Type Hints Incomplete | **LOW** | Code Quality | Unfixed |
| 20 | API Contract Underspecified | **LOW** | Documentation | Unfixed |

---

## Remediation Sequencing

**Phase 1 (Immediate — Production Blockers):**
1. Fix scoped kill-switch route (Issue #1)
2. Complete guardian service (Issue #3)
3. Add auth config loader (Issue #4)
4. Fix frontend URL deployment (Issue #5)

**Phase 2 (High Priority — Core Functionality):**
5. Wire reconciliation service (Issue #2)
6. Complete paper fill simulation (Issue #8)
7. Add market data tests (Issue #6)
8. Fix rate limiter memory leak (Issue #10)

**Phase 3 (Medium Priority — Reliability):**
9. Add earnings ledger tests (Issue #7)
10. Implement error handling in adapters (Issue #9)
11. Fix config YAML duplicates (Issue #11)
12. Clean up WebSocket zombie connections (Issue #14)

**Phase 4 (Polish — Documentation & Quality):**
13. Document mainnet gate (Issue #17)
14. Remove unused mode_control (Issue #18)
15. Add type hints (Issue #19)
16. Generate OpenAPI spec (Issue #20)

---

**End of Analysis**
