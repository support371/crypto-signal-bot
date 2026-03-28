# Crypto Signal Bot Backend

This backend is the active FastAPI trading backend currently merged into `main`.

## Runtime model

- Default mode: `paper`
- Current execution logic: **paper-only**
- Live intent endpoint exists, but in the merged backend it still routes through paper execution logic unless future real exchange integration is added deliberately
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
- `GET /orders`
- `GET /price`
- `GET /audit`
- `GET /metrics`
- `POST /intent/live`
- `POST /intent/paper`
- `POST /withdraw`
- `POST /analyze-features`
- `POST /simulate-session`

### WebSocket
- `WS /ws/updates`

## Implemented backend capabilities

- paper portfolio management
- synthetic pricing
- simulated order fills
- execution intent processing
- risk scoring and risk gating
- audit persistence
- websocket updates for status and order flow
- metrics exposure
- environment-based configuration
- Docker and docker-compose support

## Important logic note

The backend already includes a guarded live-intent endpoint, but the currently merged implementation is still paper-first and should be treated as non-live until a separate live execution adapter path is intentionally added and reviewed.

## Install and run

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload
```

## Tests

The repo already includes backend tests under `backend/tests/`.

Run them with:

```bash
cd backend
pytest
```

## Key files

- `backend/app.py`
- `backend/logic/audit_store.py`
- `backend/logic/paper_trading.py`
- `backend/logic/risk.py`
- `backend/logic/signals.py`
- `backend/logic/simulate.py`
- `backend/models/execution_intent.py`
- `backend/models/risk.py`
- `backend/tests/test_api.py`
- `backend/tests/test_risk.py`
- `backend/tests/test_signals.py`
