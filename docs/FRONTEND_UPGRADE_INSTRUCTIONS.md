# Frontend Upgrade Instructions — Crypto Signal Bot

## Purpose

This file is the standing instruction set for future frontend agents, Base44 builders, Vercel deployments, and code-review automation working on `support371/crypto-signal-bot`.

The goal is to upgrade the frontend over time while preserving the current production flow:

- Backend: `https://crypto-signal-bot-deqd.onrender.com`
- Existing Vercel frontend: `https://crypto-signal-bot-indol.vercel.app`
- New Base44 frontend: any approved `*.base44.app` deployment
- Backend runtime: FastAPI on Render
- Frontend runtime: React/Vite on Vercel and Base44
- Trading mode: paper by default
- Network: testnet by default
- Current default exchange: Binance

Do not treat this as a greenfield rebuild. This is an incremental modernization plan.

---

## Non-Negotiable Production Rules

Do not remove or break the existing Vercel frontend.

Do not remove these CORS origins:

```yaml
http://localhost:5173
http://localhost:8080
http://localhost:3000
https://crypto-signal-bot-indol.vercel.app
https://*.base44.app
https://app.base44.com
```

Do not move secrets into frontend code.

Do not expose `BACKEND_API_KEY` through any `VITE_`, `NEXT_PUBLIC_`, Base44 public variable, localStorage bootstrap, or client-side config.

The frontend may use:

```text
VITE_BACKEND_URL=https://crypto-signal-bot-deqd.onrender.com
```

The backend alone may use:

```text
BACKEND_API_KEY=<server-side operator key>
```

Do not change trading logic, risk rules, order execution, guardian logic, or strategy files unless the task explicitly targets backend trading behavior.

---

## Current Backend Contract

The frontend must call the Render backend through the configured base URL.

Required base URL:

```text
https://crypto-signal-bot-deqd.onrender.com
```

Required frontend environment variable:

```text
VITE_BACKEND_URL=https://crypto-signal-bot-deqd.onrender.com
```

Required public endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/healthz` | Health check and keep-alive ping |
| GET | `/health` | Alternate health check |
| GET | `/config` | Runtime bot configuration |
| GET | `/signal/latest` | Latest signal snapshot |
| GET | `/balance` | Account balance and paper positions |
| GET | `/positions` | Position list |
| GET | `/orders` | Open orders |
| GET | `/earnings/summary` | Earnings and P&L summary |
| GET | `/earnings/history` | Earnings history |
| GET | `/guardian/status` | Guardian/risk-engine status |
| GET | `/price?symbol=BTCUSDT` | Single-symbol price |
| POST | `/kill-switch` | Toggle kill switch; requires backend auth if configured |
| POST | `/intent/paper` | Submit paper execution intent; requires backend auth if configured |
| POST | `/intent/live` | Submit live execution intent; requires backend auth if configured |
| WS | `/ws/updates` | Runtime updates stream |

Frontend code must be resilient when optional endpoints are unavailable or delayed by Render cold starts.

---

## Required Frontend Architecture

Future frontend work should consolidate all backend calls into one client module.

Preferred location:

```text
src/lib/backend.ts
```

The frontend must not scatter `fetch()` calls across components. Components should call typed service functions, not raw URLs.

Recommended module structure:

```text
src/lib/env.ts
src/lib/backend.ts
src/lib/backendTypes.ts
src/hooks/useBackendStatus.ts
src/hooks/useBackendWebSocket.ts
src/hooks/useSignalLatest.ts
src/hooks/useGuardianStatus.ts
src/hooks/usePortfolio.ts
src/hooks/useEarnings.ts
src/components/dashboard/*
```

### Backend URL Resolution

The frontend should resolve the backend URL in this priority order:

```text
VITE_BACKEND_URL
VITE_BACKEND_BASE_URL
VITE_CRYPTOCORE_API_BASE
```

Do not fall back to localhost in production. In production, missing backend URL should show a setup-required state instead of silently failing.

### WebSocket URL Resolution

Derive WebSocket URL from the backend URL:

```text
https://host → wss://host/ws/updates
http://host  → ws://host/ws/updates
```

If the backend URL ends in `/api`, strip `/api` before appending `/ws/updates`.

---

## Base44 Frontend Integration Rules

Base44 must call the same Render backend as Vercel.

Base44 must use:

```text
https://crypto-signal-bot-deqd.onrender.com
```

Base44 must not define or store `BACKEND_API_KEY` in public client state.

For read-only dashboard flows, Base44 should use public GET endpoints only.

For privileged actions such as kill switch, paper/live intents, withdrawals, reset actions, or operator controls, use one of these patterns:

1. Server-side proxy function that injects `BACKEND_API_KEY` securely.
2. User-provided session operator key kept only in memory for the session.
3. Dedicated backend auth flow introduced later.

Do not put operator credentials in browser-persisted storage unless the task explicitly introduces a hardened auth design.

---

## Frontend UX Flow To Preserve

The dashboard should follow this operational sequence:

1. Load configuration from `/config`.
2. Ping `/healthz`.
3. Load guardian status from `/guardian/status`.
4. Load portfolio from `/balance` and `/positions`.
5. Load latest signal from `/signal/latest`.
6. Load earnings from `/earnings/summary`.
7. Connect WebSocket `/ws/updates` when available.
8. Display degraded/offline banners instead of blank screens.
9. Keep read-only views usable even if operator write auth is unavailable.

A failed WebSocket must not break the dashboard. It should degrade to polling.

A Render cold start must show `Connecting to backend...`, not a fatal error.

---

## Multi-Exchange Frontend Roadmap

The backend currently defaults to Binance but already contains an exchange adapter layer with support for:

```text
binance
bitget
btcc
paper
```

The frontend should be upgraded to display exchange state dynamically instead of assuming Binance-only behavior.

### Required Future Backend Endpoint

Add this endpoint before building advanced exchange UI:

```text
GET /exchanges
```

Recommended response contract:

```json
{
  "active_exchange": "binance",
  "active_adapter": "paper",
  "trading_mode": "paper",
  "network": "testnet",
  "supported": [
    {
      "id": "binance",
      "label": "Binance",
      "spot": true,
      "testnet": true,
      "mainnet": true,
      "paper_supported": true,
      "live_supported": true,
      "configured": false,
      "required_env": ["BINANCE_API_KEY", "BINANCE_API_SECRET"]
    },
    {
      "id": "bitget",
      "label": "Bitget",
      "spot": true,
      "testnet": true,
      "mainnet": true,
      "paper_supported": true,
      "live_supported": true,
      "configured": false,
      "required_env": ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"]
    },
    {
      "id": "btcc",
      "label": "BTCC",
      "spot": false,
      "testnet": false,
      "mainnet": true,
      "paper_supported": true,
      "live_supported": "partial",
      "configured": false,
      "required_env": ["BTCC_API_KEY", "BTCC_API_SECRET"]
    }
  ]
}
```

Until `/exchanges` exists, the frontend should infer only from `/config`:

```text
exchange
adapter
adapter_exchange
market_data_public_exchange
trading_mode
network
```

Do not hardcode Binance as the only exchange in UI labels. Use `config.exchange` or `config.market_data_public_exchange`.

---

## Dashboard Components To Build Or Upgrade

### 1. Backend Connection Panel

Show:

- backend URL
- `/healthz` status
- `/config` status
- Render cold-start state
- WebSocket connected/disconnected
- last successful response timestamp

### 2. Runtime Config Panel

Show:

- trading mode
- network
- exchange
- adapter
- market data exchange
- auth enabled
- kill switch active
- rate limit RPM

### 3. Guardian Panel

Show:

- kill switch state
- guardian trigger state
- drawdown percentage
- API error count
- failed order count
- configured thresholds

### 4. Signal Panel

Show:

- latest symbol
- direction
- confidence
- regime
- risk score
- timestamp
- stale/no-data state

### 5. Portfolio Panel

Show:

- balances
- positions
- open orders
- paper-mode badge
- live-mode warning only when backend reports live mode

### 6. Earnings Panel

Show:

- realized P&L
- trade count
- earnings history
- reset action only behind secure operator flow

### 7. Exchange Panel

Initial version:

- active exchange from `/config`
- adapter mode
- market-data source

Future version after `/exchanges` exists:

- supported exchange matrix
- configured/not configured badges
- testnet/mainnet capability labels
- read-only selector until backend supports runtime switching

---

## Error Handling Standards

Every backend request should classify errors:

| Case | UI behavior |
|---|---|
| Network error | `Backend unreachable` |
| 404 | `Endpoint unavailable` |
| 401/403 | `Operator auth required` |
| 429 | `Rate limited; retrying` |
| 500 | `Backend error` |
| 503 | `Backend warming up or service unavailable` |
| WebSocket close | `Realtime disconnected; polling active` |

Never leave the dashboard blank because one endpoint failed.

---

## Polling And Realtime Strategy

Recommended defaults:

```text
/healthz            every 30s
/config             every 60s
/guardian/status    every 10s
/signal/latest      every 10s
/balance            every 15s
/earnings/summary   every 30s
```

Use WebSocket updates when available. Polling remains the fallback.

---

## Security Rules For Frontend Agents

Do not expose backend operator secrets.

Do not add exchange API keys to frontend env vars.

Do not place secrets in:

```text
localStorage
sessionStorage
IndexedDB
VITE_ variables
NEXT_PUBLIC_ variables
Base44 public config
hardcoded source files
```

Allowed public variables:

```text
VITE_BACKEND_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_PUBLISHABLE_KEY
```

Server-only variables:

```text
BACKEND_API_KEY
BINANCE_API_KEY
BINANCE_API_SECRET
BITGET_API_KEY
BITGET_API_SECRET
BITGET_API_PASSPHRASE
BTCC_API_KEY
BTCC_API_SECRET
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY
POSTGRES_URL
POSTGRES_PASSWORD
```

---

## Deployment Rules

### Vercel

Keep Vercel as a frontend host.

Required Vercel env:

```text
VITE_BACKEND_URL=https://crypto-signal-bot-deqd.onrender.com
```

Do not deploy backend runtime to Vercel.

### Render

Keep Render as backend host.

Required health target:

```text
/healthz
```

Expected start command:

```text
python render_start.py
```

Fallback start command:

```text
bash backend/start_render.sh
```

### Base44

Configure Base44 to call:

```text
https://crypto-signal-bot-deqd.onrender.com
```

The backend already allows:

```text
https://*.base44.app
https://app.base44.com
```

---

## Test Checklist Before Merging Frontend Changes

Run or manually verify:

```text
GET https://crypto-signal-bot-deqd.onrender.com/healthz
GET https://crypto-signal-bot-deqd.onrender.com/config
GET https://crypto-signal-bot-deqd.onrender.com/guardian/status
GET https://crypto-signal-bot-deqd.onrender.com/signal/latest
GET https://crypto-signal-bot-deqd.onrender.com/balance
GET https://crypto-signal-bot-deqd.onrender.com/earnings/summary
```

Expected minimum:

- `/healthz` returns status `ok` or `healthy`
- `/config` returns CORS origins including Vercel and Base44
- `/guardian/status` returns guardian data
- frontend renders degraded states instead of crashing
- no backend secrets appear in frontend bundle

---

## Recommended Implementation Sequence

1. Stabilize `src/lib/env.ts`.
2. Consolidate all backend requests in `src/lib/backend.ts`.
3. Add typed backend response models in `src/lib/backendTypes.ts`.
4. Create dashboard hooks for config, health, signal, guardian, portfolio, earnings.
5. Add connection/degraded-state UI.
6. Add exchange status panel using `/config`.
7. Add `/exchanges` backend endpoint.
8. Upgrade frontend exchange panel to use `/exchanges`.
9. Add secure operator-action proxy for write endpoints.
10. Add contract tests for every frontend-consumed backend route.

---

## Definition Of Done

A frontend upgrade is complete only when:

- Vercel frontend still works.
- Base44 frontend works.
- Both use the same Render backend.
- Backend URL is configured, not hardcoded in components.
- Dashboard survives Render cold starts.
- WebSocket failure falls back to polling.
- Binance is no longer hardcoded as the only exchange in UI copy.
- No secrets are exposed to the browser.
- Existing trading behavior remains unchanged.
