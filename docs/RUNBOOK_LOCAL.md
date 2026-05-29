# Local Development Runbook

> Step-by-step guide to running crypto-signal-bot locally.

## Prerequisites

- Python 3.11+
- Node.js 22+ (for frontend)
- npm

## Quick Start

### Backend

```bash
cd /path/to/crypto-signal-bot

# Create virtual environment and install dependencies
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# Start backend (paper mode, no auth)
.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000

# Verify
curl http://localhost:8000/health
```

The backend starts in **paper mode** by default:
- No exchange API keys needed
- Synthetic prices generated locally
- All endpoints open (no auth) unless `BACKEND_API_KEY` is set

### Frontend

```bash
# Install dependencies
npm install

# Start dev server
npm run dev -- --host 0.0.0.0

# Opens at http://localhost:8080
```

### Both (via Makefile)

```bash
make install      # Install all dependencies
make backend      # Start backend (port 8000)
make frontend     # Start frontend (port 8080)
```

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `TRADING_MODE` | `paper` | `paper` or `live` |
| `NETWORK` | `testnet` | `testnet` or `mainnet` |
| `EXCHANGE` | `binance` | `binance`, `bitget`, or `btcc` |
| `BACKEND_API_KEY` | (empty) | Set to enable auth on write endpoints |
| `PAPER_USE_LIVE_MARKET_DATA` | `false` | Use live WebSocket feeds in paper mode |
| `MARKET_DATA_PUBLIC_EXCHANGE` | `binance` | Exchange for live market data |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `EVENT_LOG_ENABLED` | `false` | Enable SQLite event log |
| `EVENT_LOG_PATH` | `/tmp/crypto-signal-bot/event_log.db` | Event log database path |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_BACKEND_URL` | `/api` | Backend API URL |
| `VITE_SUPABASE_URL` | — | Supabase project URL (optional) |
| `VITE_SUPABASE_ANON_KEY` | — | Supabase anonymous key (optional) |

For local development, set `VITE_BACKEND_URL=http://localhost:8000` in `.env` or `.env.local`.

## Common Tasks

### Run Tests

```bash
# All backend tests
make test-v
# or
.venv/bin/python -m pytest backend/tests/ -v --tb=short

# Frontend lint
npm run lint

# Backend lint
.venv/bin/python -m ruff check backend/
```

### Test Paper Trading

```bash
# BUY
curl -X POST http://localhost:8000/intent/paper \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","side":"BUY","order_type":"MARKET","quantity":0.01}'

# Check balance
curl http://localhost:8000/balance

# SELL (use quantity from balance)
curl -X POST http://localhost:8000/intent/paper \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","side":"SELL","order_type":"MARKET","quantity":0.01}'
```

### Test Kill-Switch

```bash
# Activate
curl -X POST http://localhost:8000/kill-switch \
  -H 'Content-Type: application/json' \
  -d '{"activate":true,"reason":"test"}'

# Verify
curl http://localhost:8000/health | python3 -m json.tool

# Deactivate
curl -X POST http://localhost:8000/kill-switch \
  -H 'Content-Type: application/json' \
  -d '{"activate":false,"reason":"reset"}'
```

### Test with Auth Enabled

```bash
# Start with auth
BACKEND_API_KEY=my-secret .venv/bin/python -m uvicorn backend.app:app --port 8000

# Write endpoints now require X-API-Key header
curl -X POST http://localhost:8000/kill-switch \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: my-secret' \
  -d '{"activate":true,"reason":"auth test"}'
```

### Docker

```bash
# Build backend image
docker build -t crypto-signal-bot-backend .

# Run
docker run -p 10000:10000 \
  -e TRADING_MODE=paper \
  -e NETWORK=testnet \
  crypto-signal-bot-backend
```

### Docker Compose

```bash
make compose-preflight   # Validate compose config
make compose-up          # Start full stack
make compose-down        # Stop
```

## Troubleshooting

### Backend won't start
- Check Python version: `python3 --version` (need 3.11+)
- Check dependencies: `.venv/bin/pip install -r backend/requirements.txt`
- Check port: `lsof -i:8000` or `fuser 8000/tcp`

### Frontend can't reach backend
- Set `VITE_BACKEND_URL=http://localhost:8000` in `.env.local`
- Check CORS: backend allows `http://localhost:8080` by default
- Verify backend is running: `curl http://localhost:8000/health`

### Tests fail with import errors
- Ensure you're using the venv: `.venv/bin/python -m pytest ...`
- Reinstall deps: `.venv/bin/pip install -r backend/requirements.txt`

### Rate limit errors (429)
- Default: 120 requests/minute per IP
- Rate limit store resets on server restart
- For testing, restart the server to clear the store
