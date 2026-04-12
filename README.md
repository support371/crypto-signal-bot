# Crypto Signal Bot

![CI](https://github.com/Support371/crypto-signal-bot/actions/workflows/ci.yml/badge.svg)

A full-stack crypto trading control center — React dashboard frontend, FastAPI backend, paper trading by default with a path to live testnet and mainnet execution.

## Features

- **Signal engine** — regime classification (TREND / RANGE / CHAOS), directional signals with confidence scoring
- **Risk gate** — composite risk score from spread stress, depth decay, volatility, and price shock; blocks or sizes positions accordingly
- **Guardian service** — monitors drawdown, API errors, and failed orders; activates kill switch automatically when thresholds breach
- **Paper trading** — full order simulation with realistic slippage, portfolio tracking, and FIFO realized P&L
- **Hybrid live-paper mode** — paper execution and balances with live public Binance, Bitget, or BTCC market data
- **Earnings ledger** — per-trade realized P&L, win rate, best/worst trade, trade history
- **Exchange adapter** — pluggable: `PaperAdapter` (default) or exchange-selected authenticated adapters for Binance / Bitget / BTCC
- **WebSocket** — real-time order updates, guardian alerts, live market updates, and exchange-status updates
- **Auth + rate limiting** — optional API key on write endpoints, sliding-window rate limiting on reads
- **Dashboard** — live prices, signal panel, risk gauge, guardian panel, portfolio panel, earnings panel

---

## Quickstart — local development

### 1. Backend

```bash
# Create repo-local virtualenv + install Python deps
make backend-install

# Copy env (first time)
cp backend/env/.env.example backend/env/.env

# Start
make backend
```

Windows PowerShell quickstart:

```powershell
.\scripts\bootstrap_backend_windows.ps1
.\scripts\run_backend_windows.ps1
```

If you plan to validate exchange-backed testnet mode on Windows, install the optional adapter dependency during bootstrap:

```powershell
.\scripts\bootstrap_backend_windows.ps1 -InstallCcxt
```

Windows verification path used on this host:

```powershell
.\scripts\bootstrap_backend_windows.ps1
.\.venv\Scripts\python.exe -m pytest backend\tests -v --tb=short
.\.venv\Scripts\python.exe scripts\release_verify.py
```

Notes for this workstation:
- The Windows backend/runtime path above is verified.
- `scripts\release_verify.py` skips live-paper smoke when public exchange DNS is unavailable on the host.
- `scripts\release_verify.py` skips compose smoke when Docker Compose v2 is not installed.

Modes:

```bash
# Synthetic paper mode
cp backend/env/.env.example backend/env/.env
sed -i 's/^TRADING_MODE=.*/TRADING_MODE=paper/' backend/env/.env
sed -i 's/^PAPER_USE_LIVE_MARKET_DATA=.*/PAPER_USE_LIVE_MARKET_DATA=false/' backend/env/.env
make backend

# Real-time paper simulation mode (selected live public data, paper execution)
sed -i 's/^TRADING_MODE=.*/TRADING_MODE=paper/' backend/env/.env
sed -i 's/^EXCHANGE=.*/EXCHANGE=binance/' backend/env/.env
sed -i 's/^MARKET_DATA_PUBLIC_EXCHANGE=.*/MARKET_DATA_PUBLIC_EXCHANGE=bitget/' backend/env/.env
sed -i 's/^PAPER_USE_LIVE_MARKET_DATA=.*/PAPER_USE_LIVE_MARKET_DATA=true/' backend/env/.env
make backend

# Live exchange certification mode
sed -i 's/^TRADING_MODE=.*/TRADING_MODE=live/' backend/env/.env
sed -i 's/^EXCHANGE=.*/EXCHANGE=binance/' backend/env/.env
sed -i 's/^PAPER_USE_LIVE_MARKET_DATA=.*/PAPER_USE_LIVE_MARKET_DATA=false/' backend/env/.env
sed -i 's/^NETWORK=.*/NETWORK=testnet/' backend/env/.env
make backend
```

### 2. Frontend

```bash
# Install npm deps
npm install

# Start dev server (talks to backend at http://localhost:8000)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

Frontend tooling is standardized on Node `22.12.0` LTS.
Use `nvm use` (the repo includes `.nvmrc`) when available. The canonical frontend build helper now tries the local Node toolchain first, warns when the host is below `22.12.0`, and only falls back to Docker if the local build actually fails.

### 3. Docker — full stack

```bash
# Copy env (optional — defaults to paper mode)
cp .env.fullstack.example .env

# Check Compose support first
make compose-preflight

# Start backend + frontend via nginx
docker compose -f docker-compose.fullstack.yml up --build
```

Open [http://localhost:8080](http://localhost:8080)

Docker Compose v2 is the supported full-stack container runtime for this repo. If `make compose-preflight` fails, install the Docker Compose plugin before using the full-stack path.

### 4. Vercel — frontend only

Vercel should deploy the frontend from the **repo root** (`.`). This repo is not a Vercel monorepo setup; the deploy target is the root Vite app, while the FastAPI backend should stay on separate hosting.

Configured Vercel settings:

```text
Root Directory: .
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

Required Vercel environment variables:

```text
VITE_BACKEND_URL=https://your-backend-host.example.com
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Notes:
- `vercel.json` already includes the SPA rewrite needed for `BrowserRouter` routes like `/auth`.
- `.vercelignore` keeps backend, Docker, local env, and repo-only files out of the frontend deployment payload.
- The backend should **not** be deployed on Vercel in this repo layout; host FastAPI separately and point `VITE_BACKEND_URL` at it.
- If you leave `VITE_BACKEND_URL` unset, the frontend falls back to `http://localhost:8000`, which is correct for local dev but wrong for Vercel.

---

## Make targets

```bash
make install          # Install all backend + frontend deps
make backend          # Start backend dev server
make frontend         # Start frontend dev server
make test             # Run backend test suite
make test-v           # Verbose test output
make build            # Production frontend build
make compose-preflight # Check Docker Compose v2 availability
make compose-up       # Full-stack Docker start
make compose-down     # Full-stack Docker stop
make synthetic-paper-smoke # Validate synthetic paper mode against a running backend
make testnet-smoke    # Manual live/testnet validation for EXCHANGE=binance|bitget|btcc
EXCHANGE=btcc make testnet-smoke-dry # Safe BTCC workaround clearance for hybrid-paper feed usage
make live-paper-smoke # Validate hybrid live-paper mode against a running backend
make secured-write-smoke # Validate authenticated write endpoints against a running backend
make compose-live-paper-smoke # Start full stack and validate nginx /api + /ws live-paper flow
make release-verify   # Canonical stabilization/release verification path
make clean            # Remove build artifacts
```

---

## API reference

### GET (rate-limited, open)

| Route | Description |
|---|---|
| `GET /health` | System health, kill switch state, execution adapter mode |
| `GET /config` | Current config (sanitized, no secrets) |
| `GET /balance` | Paper portfolio balances and positions |
| `GET /positions` | Open positions |
| `GET /orders` | Open paper orders |
| `GET /price?symbol=BTCUSDT` | Synthetic or live market price |
| `GET /audit` | Persisted audit trail |
| `GET /metrics` | Prometheus metrics |
| `GET /signal/latest` | Latest backend-owned signal snapshot from manual or live-paper updates (use `?symbol=BTCUSDT` when multiple symbols are active) |
| `GET /guardian/status` | Guardian state and thresholds |
| `GET /exchange/status` | Execution mode, market-data mode, feed status |
| `GET /earnings/summary` | Realized P&L summary, win rate, avg/trade |
| `GET /earnings/history` | Per-trade closed trade history |

### POST (authenticated when `BACKEND_API_KEY` is set)

| Route | Description |
|---|---|
| `POST /market-state` | Submit market data → signal + risk + microstructure |
| `POST /intent/paper` | Submit paper trading intent |
| `POST /intent/live` | Submit intent through the guarded live adapter path; falls back to paper when live mode is not fully configured |
| `POST /kill-switch` | Activate or deactivate kill switch |
| `POST /withdraw` | Withdraw from paper portfolio |
| `POST /earnings/reset` | Reset earnings ledger |

### WebSocket

| Route | Description |
|---|---|
| `WS /ws/updates` | Health pings, order updates, guardian alerts, `market_update`, `exchange_status` |

---

## Configuration

Operational defaults now come from `backend/config/config.yaml`, with environment variables overriding those values at runtime.

### Backend (`backend/env/.env`)

```env
TRADING_MODE=paper              # paper | live
EXCHANGE=binance                # binance | bitget | btcc
PAPER_USE_LIVE_MARKET_DATA=false
MARKET_DATA_PUBLIC_EXCHANGE=binance
NETWORK=testnet                 # testnet | mainnet
BACKEND_API_KEY=                # Restricts POST endpoints when set
BINANCE_API_KEY=                # Required for EXCHANGE=binance + TRADING_MODE=live
BINANCE_API_SECRET=
BITGET_API_KEY=                 # Required for EXCHANGE=bitget + TRADING_MODE=live
BITGET_API_SECRET=
BITGET_API_PASSPHRASE=
BTCC_API_KEY=                   # Required for EXCHANGE=btcc + TRADING_MODE=live
BTCC_API_SECRET=
ALLOW_MAINNET=                  # Must be "true" to enable mainnet (safety gate)
CORS_ORIGINS=http://localhost:5173,http://localhost:8080
RATE_LIMIT_RPM=120
GUARDIAN_MAX_API_ERRORS=10
GUARDIAN_MAX_FAILED_ORDERS=5
GUARDIAN_MAX_DRAWDOWN_PCT=0.05
AUDIT_STORE_PATH=backend/data/audit.json
EARNINGS_STORE_PATH=backend/data/earnings.json
```

### Frontend (`.env` at repo root)

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Use `.env.example` as the frontend deployment template. For Vercel, set `VITE_BACKEND_URL` to your separately hosted backend origin.

Leave the Supabase values empty to run in local paper-mode without auth. Set both to enable Supabase auth and edge functions.

If `BACKEND_API_KEY` is set on the backend, open the dashboard Settings panel and enter the same value in the optional operator API key field so UI write actions can send `X-API-Key` automatically. Supabase values are optional and frontend-only unless the backend is explicitly configured to verify Supabase JWTs (not implemented in this repo).

Hybrid live-paper mode uses `MARKET_DATA_PUBLIC_EXCHANGE` for `/price`, `/signal/latest`, `/guardian/status`, `/exchange/status`, and WebSocket market updates while execution stays on the paper adapter. Binance and Bitget use websocket-first feeds with REST fallback; BTCC uses polling fallback for hybrid paper mode. If a symbol is not covered by the live-paper feed, `/price` returns a clear error instead of silently falling back to synthetic pricing.

---

## Safety model

| Layer | Behaviour |
|---|---|
| Default mode | Paper trading — no exchange connection, no real funds |
| Hybrid paper mode | `TRADING_MODE=paper` + `PAPER_USE_LIVE_MARKET_DATA=true` |
| Live mode gate | `TRADING_MODE=live` + credentials + `ccxt` installed |
| Mainnet gate | `ALLOW_MAINNET=true` required in addition to live + mainnet config |
| Guardian | Auto-activates kill switch on drawdown / error thresholds |
| Kill switch | Blocks all trade intents; visible on `/health` and dashboard |
| Auth | Optional `X-API-Key` header on all write endpoints |
| Secrets | Always in env vars, never in code or git |

---

## Architecture

```
crypto-signal-bot/
├── backend/
│   ├── app.py                    # FastAPI app — all routes, lifespan startup checks
│   ├── logic/
│   │   ├── signals.py            # Regime classification + signal generation
│   │   ├── risk.py               # Risk scoring + risk gate
│   │   ├── paper_trading.py      # Paper portfolio + order fill simulation
│   │   ├── earnings.py           # FIFO P&L ledger, realized earnings tracking
│   │   ├── exchange_adapter.py   # Adapter abstraction: Paper | exchange-selected live adapters
│   │   ├── market_data.py        # Public market-data providers for Binance, Bitget, BTCC
│   │   ├── startup_checks.py     # Mode validation, mainnet gate, env audit
│   │   ├── audit_store.py        # JSON-backed audit persistence
│   │   └── simulate.py           # Session simulator
│   ├── models/
│   │   └── execution_intent.py   # Order intent models
│   ├── models_core.py            # Features, Signal, RiskDecision
│   ├── config/config.yaml        # Risk and exchange config
│   ├── env/.env.example          # Environment template
│   └── tests/                    # Pytest suite
├── src/                          # React frontend
│   ├── components/dashboard/     # SignalPanel, GuardianPanel, EarningsPanel, …
│   ├── hooks/                    # useSignalEngine, useGuardianStatus, useEarnings, …
│   └── lib/backend.ts            # Typed API client
├── scripts/
│   ├── synthetic_paper_smoke.py  # Synthetic paper validation against a running backend
│   ├── compose_live_paper_smoke.py # Full-stack compose smoke for nginx /api + /ws live-paper flow
│   ├── live_paper_smoke.py       # Hybrid live-paper validation against a running backend
│   └── testnet_smoke.py          # Manual exchange-selected live/testnet certification harness
├── deploy/nginx.conf             # Nginx reverse proxy + WebSocket config
├── Dockerfile                    # Backend image (Python 3.11-slim)
├── Dockerfile.frontend           # Frontend image (Node build + nginx serve)
├── docker-compose.yml            # Backend only
└── docker-compose.fullstack.yml  # Backend + frontend via nginx
```

---

## Testing

```bash
# All tests
make test-v

# Canonical stabilization/release verification
make release-verify

# Specific suites
.venv/bin/python -m pytest backend/tests/test_api.py -v        # API endpoints
.venv/bin/python -m pytest backend/tests/test_live_mode.py -v  # Live mode + mainnet gate
.venv/bin/python -m pytest backend/tests/test_risk.py -v       # Risk engine
.venv/bin/python -m pytest backend/tests/test_signals.py -v    # Signal engine

# Frontend build
make build
```

Current backend defaults verified from code:
- `TRADING_MODE=paper`
- `NETWORK=testnet`
- `PAPER_USE_LIVE_MARKET_DATA=false`
- paper execution remains the default fallback whenever live execution is not fully configured

---

## Testnet quick-start

```bash
.venv/bin/pip install ccxt
export TRADING_MODE=live
export EXCHANGE=binance
export NETWORK=testnet
export BINANCE_API_KEY=your-testnet-key
export BINANCE_API_SECRET=your-testnet-secret

# Dry run (no order placed)
make testnet-smoke-dry

# Full smoke test
make testnet-smoke
```

## BTCC workaround clearance

If you want BTCC market data without blocking deployment readiness, clear BTCC through the hybrid-paper path:

```bash
export TRADING_MODE=paper
export EXCHANGE=bitget
export PAPER_USE_LIVE_MARKET_DATA=true
export MARKET_DATA_PUBLIC_EXCHANGE=btcc
EXCHANGE=btcc make testnet-smoke-dry
make live-paper-smoke
```

This keeps authenticated execution certification on Bitget or Binance while confirming BTCC public-feed readiness for hybrid paper mode.

## Live-paper quick-check

Start the backend with `TRADING_MODE=paper` and `PAPER_USE_LIVE_MARKET_DATA=true`, then run:

```bash
export MARKET_DATA_PUBLIC_EXCHANGE=bitget
make live-paper-smoke
# or through nginx:
.venv/bin/python scripts/live_paper_smoke.py --base-url http://localhost:8080/api --exchange bitget
```

## Full-stack live-paper quick-check

Use the compose-driven smoke command to boot the full stack and validate the public nginx routes end to end:

```bash
make compose-live-paper-smoke
```
