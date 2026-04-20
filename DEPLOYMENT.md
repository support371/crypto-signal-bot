# DEPLOYMENT.md
# crypto-signal-bot — Deployment Topology

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  VERCEL (frontend-only CDN host)                                │
│                                                                  │
│  crypto-signal-bot-alpha.vercel.app                             │
│  ├── Vite + React SPA (static files only)                       │
│  ├── No backend runtime                                          │
│  ├── No API routes                                              │
│  └── Reads from VITE_BACKEND_URL at runtime                     │
└─────────────────────────────────────────────────────────────────┘
                            │ HTTPS API calls
                            │ WSS WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND RUNTIME (always-on server — NOT Vercel)                │
│                                                                  │
│  FastAPI application (uvicorn)                                  │
│  ├── backend/services/market_data/   (Phase 6)                  │
│  ├── backend/services/prediction_bot/ (Phase 7)                 │
│  ├── backend/services/guardian_bot/  (Phase 8)                  │
│  ├── backend/engine/                 (Phase 9)                  │
│  ├── backend/services/audit/         (Phase 10)                 │
│  ├── backend/services/reconciliation/ (Phase 11)                │
│  └── backend/middleware/auth.py      (Phase 12)                 │
│                                                                  │
│  ┌───────────────┐   ┌────────────────────────────────────┐     │
│  │  PostgreSQL   │   │  Redis                             │     │
│  │  (Phase 11)   │   │  - price cache                     │     │
│  │  - orders     │   │  - signal cache                    │     │
│  │  - fills      │   │  - kill switch flag                │     │
│  │  - positions  │   │  - guardian counters               │     │
│  │  - audit_log  │   │  - WS pub/sub                      │     │
│  │  - etc.       │   │  - rate limit buckets              │     │
│  └───────────────┘   └────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

**Vercel is the frontend host only.** It does not run the backend runtime.
The backend must run on an always-on server (VPS, cloud VM, container, Railway, Fly.io, etc.).

---

## Runbook 1 — Local Development

### Prerequisites
- Python 3.11+
- Node.js 22+
- Redis (local or Docker)
- PostgreSQL or SQLite (SQLite for dev)

### Steps

```bash
# 1. Clone and install backend
cd backend
pip install -r requirements.txt

# 2. Create .env
cat > .env << 'EOF'
DATABASE_URL=sqlite+aiosqlite:///./dev.db
REDIS_URL=redis://localhost:6379/0
EXCHANGE_MODE=paper
BINANCE_TESTNET=true
# BACKEND_API_KEY=   # leave unset for local dev
CORS_ALLOWED_ORIGINS=http://localhost:5173
EOF

# 3. Start Redis (Docker)
docker run -d -p 6379:6379 redis:7-alpine

# 4. Start backend
uvicorn backend.main:app --reload --port 8000

# 5. Install and start frontend
cd ..
npm install
cp .env.example .env.local
# Edit .env.local: VITE_BACKEND_URL=http://localhost:8000
npm run dev
```

### Health check
```bash
curl http://localhost:8000/health
curl http://localhost:8000/exchange/status
curl http://localhost:8000/signal/latest?symbol=BTCUSDT
```

---

## Runbook 2 — Testnet Startup

### Prerequisites
- Backend server with public IP or domain
- Testnet exchange credentials (Binance Testnet or BTCC Testnet)
- PostgreSQL
- Redis

### Steps

```bash
# 1. Set environment (server)
export DATABASE_URL="postgresql+asyncpg://user:pass@localhost/crypto_bot"
export REDIS_URL="redis://localhost:6379/0"
export EXCHANGE_MODE="paper"
export BINANCE_API_KEY="testnet_key"
export BINANCE_API_SECRET="testnet_secret"
export BINANCE_TESTNET="true"
export BACKEND_API_KEY="your-operator-key"   # restrict write endpoints
export CORS_ALLOWED_ORIGINS="https://your-frontend.vercel.app"

# 2. Run database migrations
alembic upgrade head

# 3. Start backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 2

# 4. Set Vercel env vars (frontend)
# Vercel Dashboard → Project Settings → Environment Variables:
#   VITE_BACKEND_URL = https://your-backend-server.example.com
#   VITE_SUPABASE_URL = https://your-project.supabase.co
#   VITE_SUPABASE_PUBLISHABLE_KEY = your-anon-key

# 5. Redeploy frontend
vercel --prod
```

### Verify testnet connectivity
```bash
curl https://your-backend.example.com/health
curl https://your-backend.example.com/exchange/status
# Should return market_data_mode: "paper_live" (not "SYNTHETIC")
```

---

## Runbook 3 — Production Startup

### Prerequisites
- Exchange live API credentials (BTCC + Binance or Bitget)
- PostgreSQL with SSL
- Redis with password
- TLS termination (nginx or Caddy recommended)
- BACKEND_API_KEY set (non-empty, operator-controlled)

### Pre-flight checklist
```
[ ] DATABASE_URL set to PostgreSQL (not SQLite)
[ ] REDIS_URL set with auth
[ ] EXCHANGE_MODE=live
[ ] BTCC_API_KEY and BTCC_API_SECRET set
[ ] BACKEND_API_KEY set (required for kill-switch, intents, risk config)
[ ] CORS_ALLOWED_ORIGINS matches exact Vercel domain
[ ] VITE_BACKEND_URL points to HTTPS backend (no http://)
[ ] alembic upgrade head completed successfully
[ ] Guardian kill switch NOT active (GET /guardian/status)
[ ] WebSocket endpoint reachable (wss://your-backend/ws/updates)
```

### Steps

```bash
# 1. Migrate
alembic upgrade head

# 2. Start with gunicorn (multi-worker)
gunicorn backend.main:app \
  -k uvicorn.workers.UvicornWorker \
  -w 4 \
  --bind 0.0.0.0:8000 \
  --timeout 120

# 3. Verify all services start in order:
#    a. Redis (KILL_SWITCH:active = "0")
#    b. PostgreSQL (tables exist)
#    c. FastAPI (health returns mode=live)
#    d. market_data stream (exchange_status.connected = true)
#    e. prediction loop (signal/latest returns available=true)
#    f. guardian loop (guardian/status.heartbeat_healthy = true)
```

### Service readiness order
```
1. PostgreSQL        — tables must exist (alembic upgrade head)
2. Redis             — must be reachable (guardian reads kill switch)
3. FastAPI           — app starts, health route responds
4. MarketDataStream  — starts in app lifespan, begins polling exchange
5. PredictionLoop    — starts after market data stream
6. GuardianLoop      — starts last, begins heartbeat monitoring
```

---

## Environment Variable Reference

### Backend (server environment — never in frontend)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL (prod) or SQLite+aiosqlite (dev) |
| `REDIS_URL` | ✅ | Redis connection string |
| `EXCHANGE_MODE` | ✅ | `paper` or `live` |
| `BACKEND_API_KEY` | ⚠️ | Operator key for write endpoints (set in production) |
| `BTCC_API_KEY` + `BTCC_API_SECRET` | live only | BTCC exchange credentials |
| `BINANCE_API_KEY` + `BINANCE_API_SECRET` | live only | Binance credentials |
| `BINANCE_TESTNET` | | `true` for testnet (default: true) |
| `BITGET_API_KEY` + `BITGET_API_SECRET` + `BITGET_PASSPHRASE` | live only | Bitget credentials |
| `CORS_ALLOWED_ORIGINS` | ✅ | Comma-separated allowed origins |

### Frontend (Vercel environment — VITE_ prefix, public)

| Variable | Required | Description |
|---|---|---|
| `VITE_BACKEND_URL` | ✅ | HTTPS URL of the backend runtime |
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL (user auth) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon key |

### NEVER set these as VITE_ variables
- `BACKEND_API_KEY` — operator write key, backend only
- Exchange API keys — backend only

---

## Health Checks and Readiness

```bash
# Backend alive
GET /health
→ {"mode": "paper|live", "kill_switch_active": false}

# Market data live
GET /exchange/status
→ {"connected": true, "market_data_mode": "paper_live|live"}

# Signal available
GET /signal/latest?symbol=BTCUSDT
→ {"available": true, "direction": "UP|DOWN|NEUTRAL", ...}

# Guardian healthy
GET /guardian/status
→ {"kill_switch_active": false, "heartbeat_healthy": true, ...}

# WebSocket reachable
wscat -c wss://your-backend/ws/updates
→ {"type": "health", ...}
```

---

## Docker Compose (local development)

```yaml
# docker-compose.yml
version: "3.9"
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: crypto_bot
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  backend:
    build: .
    depends_on: [redis, postgres]
    environment:
      DATABASE_URL: postgresql+asyncpg://user:password@postgres/crypto_bot
      REDIS_URL: redis://redis:6379/0
      EXCHANGE_MODE: paper
      BINANCE_TESTNET: "true"
      CORS_ALLOWED_ORIGINS: "http://localhost:5173"
    ports: ["8000:8000"]
    command: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

volumes:
  pgdata:
```
