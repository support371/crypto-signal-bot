# Crypto Signal Bot

A crypto automation control center with a React frontend and a FastAPI backend for paper-trading operations, risk controls, auditability, and trading workflow simulation.

## Current status

- Backend: **FastAPI/Python** in `backend/`
- Frontend: **Vite + React + TypeScript + Tailwind + shadcn/ui**
- Default operating mode: **paper** (no real money, no real exchange connections)
- Guardian service monitors drawdown, API errors, and order failures — activates kill switch automatically

## Run commands

### Backend (local)

```bash
cd /path/to/crypto-signal-bot

# Install dependencies
pip install -r backend/requirements.txt

# Copy env (first time only)
cp backend/env/.env.example backend/env/.env

# Start
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (local)

```bash
cd /path/to/crypto-signal-bot

# Install dependencies
npm install

# Start dev server (connects to backend at http://localhost:8000 by default)
npm run dev

# Production build
npm run build
```

### Docker (backend only)

```bash
docker compose up --build
# Backend available at http://localhost:8000
```

### Docker (full stack — backend + frontend via nginx)

```bash
docker compose -f docker-compose.fullstack.yml up --build
# App available at http://localhost:8080
```

### Tests

```bash
cd /path/to/crypto-signal-bot

# Run all backend tests
python -m pytest backend/tests/ -v

# Run specific test file
python -m pytest backend/tests/test_api.py -v
python -m pytest backend/tests/test_signals.py -v
python -m pytest backend/tests/test_risk.py -v
```

## API routes

### GET (rate-limited, open)
| Route | Description |
|---|---|
| `GET /health` | System health, kill switch state, guardian status |
| `GET /config` | Current config (sanitized, no secrets) |
| `GET /balance` | Paper portfolio balances and positions |
| `GET /positions` | Open positions |
| `GET /orders` | Open paper orders |
| `GET /price?symbol=BTCUSDT` | Synthetic market price |
| `GET /audit` | Persisted audit trail |
| `GET /metrics` | Prometheus metrics |
| `GET /signal/latest` | Latest signal from last /market-state call |
| `GET /guardian/status` | Guardian service state and thresholds |

### POST (authenticated when `BACKEND_API_KEY` is set)
| Route | Description |
|---|---|
| `POST /market-state` | Submit market data, receive signal + risk + microstructure |
| `POST /intent/paper` | Submit paper trading intent |
| `POST /intent/live` | Submit intent (routes to paper unless live mode enabled) |
| `POST /kill-switch` | Activate or deactivate kill switch |
| `POST /withdraw` | Withdraw from paper portfolio |

### WebSocket
| Route | Description |
|---|---|
| `WS /ws/updates` | Real-time order updates, health, guardian alerts |

## Configuration

Copy `backend/env/.env.example` to `backend/env/.env` and set:

```env
TRADING_MODE=paper          # paper | live
NETWORK=testnet             # testnet | mainnet
BACKEND_API_KEY=            # Set to require API key on POST endpoints
CORS_ORIGINS=http://localhost:5173,http://localhost:8080
RATE_LIMIT_RPM=120          # Max GET requests per minute per IP
GUARDIAN_MAX_API_ERRORS=10  # API errors before kill switch
GUARDIAN_MAX_FAILED_ORDERS=5
GUARDIAN_MAX_DRAWDOWN_PCT=0.05  # 5% drawdown triggers halt
AUDIT_STORE_PATH=backend/data/audit.json
```

Frontend env (`.env` at repo root):
```env
VITE_BACKEND_URL=http://localhost:8000
```

## Authentication

When `BACKEND_API_KEY` is set, POST endpoints require the header:
```
X-API-Key: <your-key>
```

GET endpoints are open but rate-limited (default 120 req/min per IP).

## Guardian service

The guardian automatically activates the kill switch when:
- API errors exceed `GUARDIAN_MAX_API_ERRORS` (default 10)
- Failed orders exceed `GUARDIAN_MAX_FAILED_ORDERS` (default 5)
- Paper portfolio drawdown exceeds `GUARDIAN_MAX_DRAWDOWN_PCT` (default 5%)

Guardian state is visible at `GET /guardian/status` and broadcast via WebSocket (`type: "guardian_alert"`).

## Architecture

```
crypto-signal-bot/
├── backend/
│   ├── app.py              # FastAPI application (all routes)
│   ├── logic/
│   │   ├── signals.py      # Signal engine (regime classification, direction)
│   │   ├── risk.py         # Risk scoring and risk gate
│   │   ├── paper_trading.py # Paper portfolio and order fills
│   │   ├── audit_store.py  # JSON-backed audit persistence
│   │   └── simulate.py     # Session simulator
│   ├── models/
│   │   └── execution_intent.py
│   ├── models_core.py      # Features, Signal, RiskDecision
│   ├── config/config.yaml  # Risk and exchange config
│   ├── env/.env.example    # Environment template
│   └── tests/              # pytest test suite
├── src/                    # React frontend
│   ├── components/dashboard/
│   ├── hooks/              # useBackendStatus, useSignalEngine, etc.
│   └── lib/backend.ts      # API client
├── Dockerfile              # Backend image
├── Dockerfile.frontend     # Frontend nginx image
├── docker-compose.yml      # Backend only
└── docker-compose.fullstack.yml  # Backend + frontend
```

## Safety

- Paper mode is the default and cannot be disabled without explicit env config
- Live trading requires `TRADING_MODE=live` plus exchange credentials
- All secrets stay in env, never in code
- Kill switch can be activated via API (`POST /kill-switch`) or automatically by the guardian
