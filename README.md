# Crypto Signal Bot

![CI](https://github.com/Support371/crypto-signal-bot/actions/workflows/ci.yml/badge.svg)

A full-stack crypto trading control center — React dashboard frontend, FastAPI backend, paper trading by default with a path to live testnet and mainnet execution.

## Features

- **Signal engine** — regime classification (TREND / RANGE / CHAOS), directional signals with confidence scoring
- **Risk gate** — composite risk score from spread stress, depth decay, volatility, and price shock; blocks or sizes positions accordingly
- **Guardian service** — monitors drawdown, API errors, and failed orders; activates kill switch automatically when thresholds breach
- **Paper trading** — full order simulation with realistic slippage, portfolio tracking, and FIFO realized P&L
- **Earnings ledger** — per-trade realized P&L, win rate, best/worst trade, trade history
- **Exchange adapter** — pluggable: `PaperAdapter` (default) or `BinanceCCXTAdapter` (testnet/mainnet, config-gated)
- **WebSocket** — real-time order updates and guardian alerts
- **Auth + rate limiting** — optional API key on write endpoints, sliding-window rate limiting on reads
- **Dashboard** — live prices, signal panel, risk gauge, guardian panel, portfolio panel, earnings panel

---

## Quickstart — local development

### 1. Backend

```bash
# Install Python deps
pip install -r backend/requirements.txt

# Copy env (first time)
cp backend/env/.env.example backend/env/.env

# Start
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend

```bash
# Install npm deps
npm install

# Start dev server (talks to backend at http://localhost:8000)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### 3. Docker — full stack

```bash
# Copy env (optional — defaults to paper mode)
cp .env.fullstack.example .env

# Start backend + frontend via nginx
docker compose -f docker-compose.fullstack.yml up --build
```

Open [http://localhost:8080](http://localhost:8080)

---

## Make targets

```bash
make install          # Install all backend + frontend deps
make backend          # Start backend dev server
make frontend         # Start frontend dev server
make test             # Run backend test suite
make test-v           # Verbose test output
make build            # Production frontend build
make compose-up       # Full-stack Docker start
make compose-down     # Full-stack Docker stop
make testnet-smoke    # Manual Binance testnet validation
make clean            # Remove build artifacts
```

---

## API reference

### GET (rate-limited, open)

| Route | Description |
|---|---|
| `GET /health` | System health, kill switch state, adapter mode |
| `GET /config` | Current config (sanitized, no secrets) |
| `GET /balance` | Paper portfolio balances and positions |
| `GET /positions` | Open positions |
| `GET /orders` | Open paper orders |
| `GET /price?symbol=BTCUSDT` | Synthetic or live market price |
| `GET /audit` | Persisted audit trail |
| `GET /metrics` | Prometheus metrics |
| `GET /signal/latest` | Latest signal from last /market-state call |
| `GET /guardian/status` | Guardian state and thresholds |
| `GET /earnings/summary` | Realized P&L summary, win rate, avg/trade |
| `GET /earnings/history` | Per-trade closed trade history |

### POST (authenticated when `BACKEND_API_KEY` is set)

| Route | Description |
|---|---|
| `POST /market-state` | Submit market data → signal + risk + microstructure |
| `POST /intent/paper` | Submit paper trading intent |
| `POST /intent/live` | Submit intent (routes to paper unless live mode active) |
| `POST /kill-switch` | Activate or deactivate kill switch |
| `POST /withdraw` | Withdraw from paper portfolio |
| `POST /earnings/reset` | Reset earnings ledger |

### WebSocket

| Route | Description |
|---|---|
| `WS /ws/updates` | Real-time order updates, health pings, guardian alerts |

---

## Configuration

### Backend (`backend/env/.env`)

```env
TRADING_MODE=paper              # paper | live
NETWORK=testnet                 # testnet | mainnet
BACKEND_API_KEY=                # Restricts POST endpoints when set
BINANCE_API_KEY=                # Required for TRADING_MODE=live
BINANCE_API_SECRET=             # Required for TRADING_MODE=live
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
```

---

## Safety model

| Layer | Behaviour |
|---|---|
| Default mode | Paper trading — no exchange connection, no real funds |
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
│   │   ├── exchange_adapter.py   # Adapter abstraction: Paper | CCXT testnet/mainnet
│   │   ├── startup_checks.py     # Mode validation, mainnet gate, env audit
│   │   ├── audit_store.py        # JSON-backed audit persistence
│   │   └── simulate.py           # Session simulator
│   ├── models/
│   │   └── execution_intent.py   # Order intent models
│   ├── models_core.py            # Features, Signal, RiskDecision
│   ├── config/config.yaml        # Risk and exchange config
│   ├── env/.env.example          # Environment template
│   └── tests/                    # 99-test pytest suite
├── src/                          # React frontend
│   ├── components/dashboard/     # SignalPanel, GuardianPanel, EarningsPanel, …
│   ├── hooks/                    # useSignalEngine, useGuardianStatus, useEarnings, …
│   └── lib/backend.ts            # Typed API client
├── scripts/
│   └── testnet_smoke.py          # Manual Binance testnet validation script
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
python -m pytest backend/tests/ -v

# Specific suites
python -m pytest backend/tests/test_api.py -v        # API endpoints (58 tests)
python -m pytest backend/tests/test_live_mode.py -v  # Live mode + mainnet gate (17 tests)
python -m pytest backend/tests/test_risk.py -v       # Risk engine (12 tests)
python -m pytest backend/tests/test_signals.py -v    # Signal engine (11 tests)

# Frontend build
npm run build
```

**99 tests — all pass.**

---

## Testnet quick-start

```bash
pip install ccxt
# Get free testnet keys at https://testnet.binance.vision
export TRADING_MODE=live
export NETWORK=testnet
export BINANCE_API_KEY=your-testnet-key
export BINANCE_API_SECRET=your-testnet-secret

# Dry run (no order placed)
python scripts/testnet_smoke.py --dry-run

# Full smoke test
python scripts/testnet_smoke.py
```
