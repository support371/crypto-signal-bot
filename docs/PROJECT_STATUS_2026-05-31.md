# Crypto Signal Bot — Current Project Status

Date: 2026-05-31
Repository: `support371/crypto-signal-bot`
Default branch: `main`

## Purpose

This status note records the current repository state after reviewing the live GitHub code. It is meant to prevent the team from working from stale issue notes and to make the next engineering steps clear.

## Current architecture

The project is a full-stack crypto trading control center:

- React/Vite dashboard frontend.
- FastAPI backend.
- Paper trading by default.
- Optional live/testnet exchange path through guarded adapters.
- Guardian kill switch, reconciliation, risk gate, WebSocket updates, earnings ledger, and deployment docs.

## Verified fixed or already implemented

### 1. Scoped kill-switch route is wired

`backend/routes/kill_switch.py` exposes `POST /kill-switch/scope`, and `backend/app.py` imports and includes `kill_switch_router`. This means strategy/venue scoped kill-switch controls should no longer 404 simply because the router was missing.

Relevant files:

- `backend/app.py`
- `backend/routes/kill_switch.py`

### 2. Guardian service exists and has the expected functions

`backend/services/guardian_bot/service.py` contains the expected runtime guardian functions, including global kill switch activation/deactivation, scoped strategy/venue halt and revive, status reporting, heartbeat checks, reconciliation drift handling, and runtime threshold overrides.

Relevant file:

- `backend/services/guardian_bot/service.py`

### 3. Auth config loader exists

`backend/config/loader.py` provides `AuthConfig` and `get_auth_config()`, so kill-switch route auth imports are present.

Relevant file:

- `backend/config/loader.py`

### 4. Reconciliation service is started and exposed

`backend/app.py` starts reconciliation during application lifespan, stops it on shutdown, and exposes:

- `GET /reconciliation/status`
- `GET /reconciliation/exchange`

Relevant file:

- `backend/app.py`

### 5. Rate limiter has been hardened

The rate limiter is now in `backend/logic/rate_limit.py` and includes:

- Thread lock for in-memory fallback.
- Stale IP eviction.
- `X-Forwarded-For` support.
- Optional Redis-backed async path.

Relevant file:

- `backend/logic/rate_limit.py`

### 6. Paper trading SELL fill path is implemented

`backend/logic/paper_trading.py` now handles SELL fills by checking base-asset balance, reducing or removing base balance, crediting quote balance, marking the order filled, and appending the filled order.

Relevant file:

- `backend/logic/paper_trading.py`

## Items that still need engineering attention

### P1 — Validate current CI and release health

Run the repository’s canonical checks locally or in CI:

```bash
make test-v
make build
make release-verify
```

Also verify GitHub Actions and CircleCI are both green after the latest fixes.

### P1 — Update stale issue documentation

`ISSUES_ANALYSIS.md` still lists some items as open/unfixed that now appear implemented in code. It should be updated or replaced with a living issue tracker so future work does not repeat already-fixed tasks.

### P1 — Add regression tests for verified fixes

Add or confirm tests for:

- `POST /kill-switch/scope`
- Guardian status fields
- Reconciliation status endpoint
- Paper BUY/SELL fill behavior
- Rate limiter memory cleanup

### P2 — Improve frontend/backend deployment confidence

Confirm the deployed frontend uses the correct backend URL:

```env
VITE_BACKEND_URL=https://your-backend-host.example.com
```

For Vercel, the frontend should deploy from the repo root while the FastAPI backend stays on a separate backend host.

### P2 — Check API version consistency

`backend/app.py` defines FastAPI version `2.3.0` and the root route returns `2.3.0`. Check any fallback responses, docs, and deployment pages for older version strings before the next release.

## Recommended next coding task

Start with regression tests, not new features:

1. Add `backend/tests/test_kill_switch_scope.py`.
2. Add `backend/tests/test_paper_trading_fill.py` for BUY, SELL, insufficient balance, and balance updates.
3. Add `backend/tests/test_reconciliation_status.py`.
4. Run `make test-v` and `make release-verify`.

This is the safest next step because core runtime behavior now appears implemented, but tests are what will protect the project before deploying or connecting real exchange credentials.
