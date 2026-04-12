# Build Status Report

## Canonical repository

- Repo: `support371/crypto-signal-bot`
- Frontend: **Vite + React + TypeScript + Tailwind + shadcn/ui**
- Backend: **FastAPI/Python** in `backend/`
- Deployment: `docker-compose.fullstack.yml`
- Run helpers: `Makefile`
- Deployment guide: `DEPLOYMENT.md`
- Canonical execution brief: `TODO.md`

---

## Completed — as of 2026-04-12

### Backend API (24 endpoints)
| Route | Status |
|---|---|
| GET /health, /config, /balance, /positions, /orders, /price, /audit, /metrics | ✅ |
| GET /signal/latest, /guardian/status | ✅ |
| GET /earnings/summary, /earnings/history | ✅ |
| POST /market-state, /intent/paper, /intent/live, /kill-switch, /withdraw | ✅ |
| POST /earnings/reset | ✅ |
| WS /ws/updates | ✅ |

### Backend controls
- API-key enforcement on POST routes ✅
- Rate limiting on GET routes ✅
- Guardian service with automatic kill-switch ✅
- WebSocket alert and order update broadcasting ✅
- Paper portfolio + simulated execution ✅
- **Exchange adapter abstraction** (PaperAdapter default, BinanceCCXTAdapter for live) ✅
- **Startup validation** (mode banner, mainnet safety gate, env checks) ✅

### Earnings / P&L architecture
- FIFO lot-matching earnings ledger (`backend/logic/earnings.py`) ✅
- Realized P&L tracked per symbol, persisted to `earnings.json` ✅
- Summary: total P&L, win rate, avg/trade, best/worst trade ✅
- History: per-trade records with entry/exit prices and P&L % ✅
- EarningsPanel on frontend dashboard ✅

### Exchange adapter
- `backend/logic/exchange_adapter.py`: abstract base + PaperAdapter + BinanceCCXTAdapter ✅
- Config-gated: CCXT only activates on `TRADING_MODE=live` + credentials + ccxt installed ✅
- Mainnet hard gate: requires `ALLOW_MAINNET=true` in addition to live + mainnet config ✅
- Safe fallback to paper on any missing prerequisite ✅
- Adapter mode exposed on `/health` and `/config` ✅

### Live mode validation
- `backend/logic/startup_checks.py`: startup banner, mainnet gate, credential + ccxt warnings ✅
- `backend/tests/test_live_mode.py`: 16 tests covering routing, gates, and startup checks ✅
- `scripts/testnet_smoke.py`: standalone manual testnet validation script ✅

### Frontend
- Dashboard: PriceChart, SignalPanel, RiskGauge, MicrostructureDisplay, AIInsightCard ✅
- GuardianPanel, PortfolioPanel, EarningsPanel ✅
- WebSocket hook, backend status polling, guardian polling, portfolio polling ✅
- Auto-trade paper flow with kill-switch respect ✅
- Settings persistence ✅

### Deployment / tooling
- `Dockerfile`, `Dockerfile.frontend`, `docker-compose.yml`, `docker-compose.fullstack.yml` ✅
- `.env.fullstack.example`, `DEPLOYMENT.md`, `Makefile`, CI/CD workflows ✅
- Hardened `.gitignore` (secrets, logs, build artifacts, data) ✅

### Test suite
- **129 backend tests total — all pass**
- `test_api.py`: health, config, balance, positions, price, orders, audit, signals, guardian,
  kill-switch, auth, rate limiting, intents, withdraw, market-state, earnings (12), adapter (11), WS
- `test_live_mode.py`: adapter routing (7), mainnet gate (6), startup checks (4)
- `test_risk.py`: risk score (6), risk gate (6)
- `test_signals.py`: regime (5), signal build (6)
- `test_runtime_config.py`: YAML defaults, env overrides, default paper balance
- Frontend production build: ✅ passes

### Windows local verification
- `scripts/bootstrap_backend_windows.ps1` successfully creates a working repo-local `.venv` on this host ✅
- Backend test suite passes on Windows using `.venv\Scripts\python.exe` ✅
- `scripts/release_verify.py` passes backend tests, frontend build, and secured-write smoke on this host ✅
- Hybrid live-paper smoke is currently host-blocked because public exchange DNS resolution fails on this workstation ⚠️
- Compose smoke is currently host-blocked because Docker Compose v2 is not installed on this workstation ⚠️

---

## Remaining work

### Testnet live validation (next)
- Obtain Binance testnet API keys from https://testnet.binance.vision
- Install ccxt: `pip install ccxt`
- Run: `python scripts/testnet_smoke.py`
- Verify adapter mode shows `testnet` on GET /health

### Live mainnet rollout (after testnet confirmed)
- Set `TRADING_MODE=live NETWORK=mainnet ALLOW_MAINNET=true`
- Set real Binance mainnet credentials in env
- Confirm startup banner shows mainnet warning
- Full guardian threshold review before any real funds

### Publication readiness
- Final README pass for external audience
- Docker Hub or registry publish of images
- Preview/staging deployment verification

### Known host-specific blockers
- Public exchange DNS access is unavailable on the current Windows workstation, so live-paper feed smoke remains blocked here.
- Docker Compose v2 is not installed on the current Windows workstation, so compose smoke remains blocked here.

---

## Working rules

- Default mode is always **paper** — never changes without explicit env config
- `TODO.md` is the canonical execution brief
- `DEPLOYMENT.md` + `docker-compose.fullstack.yml` are the active deployment path
- Never rebuild into a different stack
