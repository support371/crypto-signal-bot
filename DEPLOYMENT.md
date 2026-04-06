# Deployment Guide

## Overview

The application ships as two containers:
- **Backend** — FastAPI/Python, port 8000 internally
- **Frontend** — Vite/React build served by Nginx, port 8080 externally; proxies `/api/*` and `/ws/*` to the backend

Default mode is always **paper trading** — no exchange connection, no real funds.
Optional hybrid paper mode keeps execution paper-only while using selected live public exchange market data.

This repo has two deployment paths:
- Docker Compose for full local/backend+frontend operation
- Vercel for the **frontend only**

The FastAPI backend is not structured as a Vercel serverless deployment target and should be hosted separately.

---

## Local full-stack (Docker Compose)

### 1. Copy env

```bash
cp .env.fullstack.example .env
```

Edit `.env` to set `BACKEND_API_KEY` and any other values. All defaults work for paper mode without changes.
Keep `.env` values plain; put comments on separate lines rather than after values.

### 2. Start

```bash
make compose-preflight
docker compose -f docker-compose.fullstack.yml up --build
```

Docker Compose v2 is the supported full-stack runtime for this repo. If `make compose-preflight` fails, install the Docker Compose plugin before using the container path.

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
```

---

## Local development (no Docker)

### Backend

```bash
make backend-install
cp backend/env/.env.example backend/env/.env
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
Use Node `22.12.0` LTS for the Vite frontend toolchain. The repo includes `.nvmrc`, and `make build` will fall back to the Docker Node 22 frontend build stage when your host Node is older.

---

## Vercel deployment

### What Vercel should deploy

- Deploy the **frontend only**
- Use the **repo root** (`.`) as the Vercel project root
- Do **not** point Vercel at `backend/`

This repo is not a Vercel monorepo configuration. The root `package.json` and `vite.config.ts` are the correct frontend deployment target.

### Vercel project settings

```text
Root Directory: .
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

`vercel.json` in the repo already locks those settings and includes the SPA rewrite required by React Router `BrowserRouter`.
`.vercelignore` excludes backend, Docker, and local-only files so the Vercel deployment stays frontend-only.

### Required Vercel environment variables

```text
VITE_BACKEND_URL=https://your-backend-host.example.com
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Important:
- `VITE_BACKEND_URL` must point to your separately hosted FastAPI backend
- leaving it unset makes the frontend fall back to `http://localhost:8000`, which is only correct for local development
- Supabase variables are optional; leave both empty for local-mode/no-auth behavior

### Auto deployment behavior

Once the GitHub repo is connected in Vercel, auto deployment from GitHub will work from `main` because:
- the frontend deployment target is the repo root
- the root contains `package.json` and `vite.config.ts`
- the expected output directory is `dist`
- `vercel.json` provides the SPA rewrite for non-file routes like `/auth`

The backend still needs separate hosting and is not auto-deployed by Vercel from this repo.

---

## Environment variables

`backend/config/config.yaml` provides the backend’s default operational settings. Environment variables still take precedence for deployment-specific overrides.

### Core

| Variable | Default | Description |
|---|---|---|
| `TRADING_MODE` | `paper` | `paper` or `live` |
| `EXCHANGE` | `binance` | Authenticated live execution venue: `binance`, `bitget`, or `btcc` |
| `PAPER_USE_LIVE_MARKET_DATA` | `false` | `true` = paper execution with live public market data |
| `MARKET_DATA_PUBLIC_EXCHANGE` | `binance` | Public feed used in hybrid paper mode; defaults to `EXCHANGE` in runtime config |
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

### Live mode credentials (set only when TRADING_MODE=live)

| Variable | Description |
|---|---|
| `BINANCE_API_KEY` | Binance API key (testnet or mainnet) |
| `BINANCE_API_SECRET` | Binance API secret |
| `BITGET_API_KEY` | Bitget API key |
| `BITGET_API_SECRET` | Bitget API secret |
| `BITGET_API_PASSPHRASE` | Bitget API passphrase |
| `BTCC_API_KEY` | BTCC API key |
| `BTCC_API_SECRET` | BTCC API secret |
| `ALLOW_MAINNET` | Must be `true` to enable mainnet — additional safety gate |

### Optional frontend auth / AI

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL for browser auth and edge-function calls |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable anon key for the frontend |

If both are empty, the dashboard runs in local mode without a login wall and skips Supabase edge functions.
Supabase auth is frontend-only unless the backend is explicitly configured to verify Supabase JWTs (not implemented in this repo).

If `BACKEND_API_KEY` is configured, the frontend dashboard can still operate write endpoints. Open Settings in the UI and store the same value in the operator API key field so requests include `X-API-Key`.

## Run modes

### Synthetic paper mode

```env
TRADING_MODE=paper
EXCHANGE=binance
MARKET_DATA_PUBLIC_EXCHANGE=binance
PAPER_USE_LIVE_MARKET_DATA=false
NETWORK=testnet
```

### Real-time paper simulation mode

```env
TRADING_MODE=paper
EXCHANGE=binance
MARKET_DATA_PUBLIC_EXCHANGE=bitget
PAPER_USE_LIVE_MARKET_DATA=true
NETWORK=testnet
```

This keeps execution on the `PaperAdapter` while enabling selected public market data for `/price`, `/signal/latest`, `/guardian/status`, `/exchange/status`, and `WS /ws/updates`. If a symbol is not covered by the live-paper feed, `/price` returns a clear error instead of silently falling back to synthetic pricing.

Validate synthetic paper mode with:

```bash
make synthetic-paper-smoke
```

Validate a running backend with:

```bash
make live-paper-smoke
# or against nginx:
.venv/bin/python scripts/live_paper_smoke.py --base-url http://localhost:8080/api --exchange bitget
```

Validate the full compose stack end to end with:

```bash
make compose-live-paper-smoke
```

Run the canonical stabilization/release verification path with:

```bash
make release-verify
```

### Live exchange certification mode

```env
TRADING_MODE=live
EXCHANGE=binance
PAPER_USE_LIVE_MARKET_DATA=false
NETWORK=testnet
BINANCE_API_KEY=your-testnet-key
BINANCE_API_SECRET=your-testnet-secret
```

## Testnet deployment

1. Install ccxt:
```bash
   .venv/bin/pip install ccxt
   ```

2. Set env:
   ```env
   TRADING_MODE=live
   EXCHANGE=binance
   PAPER_USE_LIVE_MARKET_DATA=false
   NETWORK=testnet
   BINANCE_API_KEY=your-testnet-key
   BINANCE_API_SECRET=your-testnet-secret
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   ```

3. Validate with the smoke test:
   ```bash
   make testnet-smoke-dry   # connection only
   make testnet-smoke       # full order test
   ```
   Use `EXCHANGE=bitget` to run the same harness against Bitget demo/testnet credentials.
   `EXCHANGE=btcc make testnet-smoke-dry` now runs the safe workaround-clearance path for BTCC public-feed usage in hybrid paper mode.

### BTCC workaround deployment path

Use this when you want BTCC market data in production readiness without waiting on BTCC authenticated demo/testnet spot trading:

```env
TRADING_MODE=paper
EXCHANGE=bitget
PAPER_USE_LIVE_MARKET_DATA=true
MARKET_DATA_PUBLIC_EXCHANGE=btcc
NETWORK=testnet
BITGET_API_KEY=your-bitget-demo-key
BITGET_API_SECRET=your-bitget-demo-secret
BITGET_API_PASSPHRASE=your-bitget-demo-passphrase
```

Then validate:

```bash
EXCHANGE=btcc make testnet-smoke-dry
MARKET_DATA_PUBLIC_EXCHANGE=btcc make live-paper-smoke
```

This clears BTCC for hybrid public-market-data operation while keeping authenticated execution certification on Bitget.

4. Confirm `GET /health` returns `"adapter": "testnet"` and `GET /exchange/status` returns `"execution_mode": "testnet"`.

---

## Mainnet deployment

> **Only proceed after testnet validation is complete.**

1. Obtain production exchange credentials with Spot trading enabled.

2. Set env:
   ```env
   TRADING_MODE=live
   EXCHANGE=binance
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
   and `GET /health` returns `"adapter": "mainnet"` with `GET /exchange/status` reporting `"execution_mode": "mainnet"`.

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
- [ ] Only the Supabase publishable key is exposed to the frontend; never ship a service-role key
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
- `exchange` — selected hybrid market-data exchange when active
- `market_data_mode` — synthetic_paper | live_public_paper | live_execution
- `market_data_source` — synthetic or selected exchange feed source
- `kill_switch_active` — boolean
- `guardian_triggered` — boolean
- `api_error_count`, `failed_order_count`
