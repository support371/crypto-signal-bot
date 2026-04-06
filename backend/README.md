# Crypto Signal Bot Backend

This backend is the active FastAPI trading backend currently merged into `main`.

## Runtime model

- Default mode: `paper`
- Synthetic paper mode is the default startup path
- Hybrid live-paper mode is supported through public Binance market data with paper execution
- Live Binance execution is supported only when `TRADING_MODE=live`, `ccxt` is installed, credentials are present, and mainnet is explicitly allowed when applicable
- No real exchange connection is active by default

## Main application

- Entry point: `backend/app.py`
- Framework: **FastAPI**
- Local serving: **Uvicorn**

## Available routes

### HTTP
- `GET /health`
- `GET /config`
- `GET /balance`
- `GET /positions`
- `GET /orders`
- `GET /price`
- `GET /audit`
- `GET /metrics`
- `GET /signal/latest`
- `GET /guardian/status`
- `GET /exchange/status`
- `GET /earnings/summary`
- `GET /earnings/history`
- `POST /market-state`
- `POST /intent/live`
- `POST /intent/paper`
- `POST /kill-switch`
- `POST /withdraw`
- `POST /earnings/reset`
- `POST /analyze-features`
- `POST /simulate-session`

### WebSocket
- `WS /ws/updates`

## Implemented backend capabilities

- paper portfolio management
- synthetic pricing
- Binance public websocket + REST fallback market data for hybrid live-paper mode
- simulated order fills
- execution intent processing
- risk scoring and risk gating
- guardian kill-switch evaluation
- audit persistence
- websocket updates for status and order flow
- metrics exposure
- YAML + environment-based configuration
- Docker and Docker Compose v2 support

## Important logic note

Live execution scope is deliberately narrow in this repo:
- Binance only
- testnet or guarded mainnet only
- paper remains the fallback whenever live mode is not fully configured

## Install and run

```bash
make backend-install
cp backend/env/.env.example backend/env/.env
make backend
```

## Tests

```bash
make test
```

## Key files

- `backend/app.py`
- `backend/config/runtime.py`
- `backend/logic/exchange_adapter.py`
- `backend/logic/market_data.py`
- `backend/logic/audit_store.py`
- `backend/logic/earnings.py`
- `backend/logic/paper_trading.py`
- `backend/logic/risk.py`
- `backend/logic/signals.py`
- `backend/logic/simulate.py`
- `backend/models/execution_intent.py`
- `backend/tests/test_api.py`
- `backend/tests/test_live_mode.py`
- `backend/tests/test_risk.py`
- `backend/tests/test_signals.py`
