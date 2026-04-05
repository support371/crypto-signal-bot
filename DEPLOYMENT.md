# Deployment Guide

## Overview

The application ships as two containers:
- **Backend** — FastAPI/Python, port 8000 internally
- **Frontend** — Vite/React build served by Nginx, port 8080 externally; proxies `/api/*` and `/ws/*` to the backend

Default mode is always **paper trading** — no exchange connection, no real funds.

---

## Local full-stack (Docker Compose)

### 1. Copy env

```bash
cp .env.fullstack.example .env
```

Edit `.env` to set `BACKEND_API_KEY` and any other values. All defaults work for paper mode without changes.

### 2. Start

```bash
docker compose -f docker-compose.fullstack.yml up --build
# or
make compose-up
```

### 3. Access

| Service | URL |
|---|---|
| Dashboard | http://localhost:8080 |
| Backend API (via nginx) | http://localhost:8080/api |
| WebSocket (via nginx) | ws://localhost:8080/ws/updates |
| Backend direct | http://localhost:8000 (if running backend-only) |

### 4. Stop

```bash
docker compose -f docker-compose.fullstack.yml down
# or
make compose-down
```

---

## Local development (no Docker)

### Backend

```bash
pip install -r backend/requirements.txt
cp backend/env/.env.example backend/env/.env
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
# or
make backend
```

### Frontend

```bash
npm install
npm run dev
# or
make frontend
```

Frontend connects to backend at `http://localhost:8000` (via `VITE_BACKEND_URL`).

---

## Environment variables

### Core

| Variable | Default | Description |
|---|---|---|
| `TRADING_MODE` | `paper` | `paper` or `live` |
| `NETWORK` | `testnet` | `testnet` or `mainnet` |
| `BACKEND_API_KEY` | _(empty)_ | API key for POST endpoints; empty = open dev mode |
| `CORS_ORIGINS` | localhost origins | Comma-separated allowed origins |
| `RATE_LIMIT_RPM` | `120` | GET requests per minute per IP |

### Guardian

| Variable | Default | Description |
|---|---|---|
| `GUARDIAN_MAX_API_ERRORS` | `10` | API errors before kill switch |
| `GUARDIAN_MAX_FAILED_ORDERS` | `5` | Failed orders before kill switch |
| `GUARDIAN_MAX_DRAWDOWN_PCT` | `0.05` | Portfolio drawdown (5%) before kill switch |

### Persistence

| Variable | Default | Description |
|---|---|---|
| `AUDIT_STORE_PATH` | `backend/data/audit.json` | Audit trail file |
| `EARNINGS_STORE_PATH` | `backend/data/earnings.json` | Earnings ledger file |

### Live mode (set only when TRADING_MODE=live)

| Variable | Description |
|---|---|
| `BINANCE_API_KEY` | Binance API key (testnet or mainnet) |
| `BINANCE_API_SECRET` | Binance API secret |
| `ALLOW_MAINNET` | Must be `true` to enable mainnet — additional safety gate |

---

## Testnet deployment

1. Get free Binance testnet keys at https://testnet.binance.vision

2. Install ccxt:
   ```bash
   pip install ccxt
   ```

3. Set env:
   ```env
   TRADING_MODE=live
   NETWORK=testnet
   BINANCE_API_KEY=your-testnet-key
   BINANCE_API_SECRET=your-testnet-secret
   ```

4. Validate with the smoke test:
   ```bash
   python scripts/testnet_smoke.py --dry-run   # connection only
   python scripts/testnet_smoke.py              # full order test
   ```

5. Confirm `GET /health` returns `"adapter": "testnet"`.

---

## Mainnet deployment

> **Only proceed after testnet validation is complete.**

1. Obtain mainnet Binance API keys with Spot trading enabled.

2. Set env:
   ```env
   TRADING_MODE=live
   NETWORK=mainnet
   BINANCE_API_KEY=your-mainnet-key
   BINANCE_API_SECRET=your-mainnet-secret
   ALLOW_MAINNET=true
   BACKEND_API_KEY=strong-random-secret
   ```

3. Review guardian thresholds — tighten for real-money exposure:
   ```env
   GUARDIAN_MAX_DRAWDOWN_PCT=0.02    # 2% for live
   GUARDIAN_MAX_API_ERRORS=5
   GUARDIAN_MAX_FAILED_ORDERS=3
   ```

4. Start and verify startup banner shows:
   ```
   ⚠  MAINNET MODE ACTIVE — REAL FUNDS AT RISK  ⚠
   ```
   and `GET /health` returns `"adapter": "mainnet"`.

5. Test kill switch before any trading:
   ```bash
   curl -X POST http://localhost:8000/kill-switch \
     -H "X-API-Key: your-key" \
     -H "Content-Type: application/json" \
     -d '{"activate": true, "reason": "pre-launch test"}'
   ```

---

## Security checklist

- [ ] `BACKEND_API_KEY` set to a strong random value
- [ ] `backend/env/.env` excluded from git (`.gitignore` covers this)
- [ ] `ALLOW_MAINNET` only set when deliberately going live
- [ ] Guardian thresholds reviewed for live risk tolerance
- [ ] `CORS_ORIGINS` restricted to your actual domain in production
- [ ] Docker volumes for `/app/backend/data` to persist audit + earnings across restarts

---

## Health check

```bash
curl http://localhost:8000/health
```

Response includes:
- `mode` — paper | live
- `adapter` — paper | testnet | mainnet
- `kill_switch_active` — boolean
- `guardian_triggered` — boolean
- `api_error_count`, `failed_order_count`
