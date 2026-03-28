# Crypto Signal Bot

Crypto Signal Bot is a crypto automation control center with a React frontend and a FastAPI backend for paper-trading operations, risk controls, auditability, and trading workflow simulation.

## Current status

- Backend source of truth: **FastAPI/Python** in `backend/`
- Frontend stack: **Vite + React + TypeScript + Tailwind**
- Default operating mode: **paper**
- Live intent route exists, but the backend currently routes execution through paper-mode logic only
- No real exchange execution is active by default

## Architecture

### Frontend
The frontend provides the control-center user interface for dashboarding, monitoring, and operator workflows.

### Backend
The backend lives in `backend/app.py` and currently provides:
- health and runtime status
- config inspection
- balances and positions
- orders
- pricing
- audit trail
- metrics
- paper trading intent processing
- guarded live intent endpoint
- websocket updates
- session simulation and analysis endpoints

## Active backend routes

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

## Trading mode and safety

- Default mode is `paper`
- Current backend logic is paper-only
- No real exchange connections are active in the merged backend
- Any future live-money rollout should remain disabled by default until credentials, safety controls, deployment hardening, and compliance review are completed

## Backend features already present

- paper portfolio tracking
- simulated fills and synthetic pricing
- risk scoring and risk gate logic
- JSON-backed audit persistence
- Prometheus-style metrics support
- Docker and docker-compose setup
- pytest test suite for API, risk, and signal flows

## Project structure

- `backend/app.py` — main FastAPI application
- `backend/logic/` — trading, risk, signal, simulation, and audit logic
- `backend/models/` — execution and risk models
- `backend/tests/` — backend tests
- `backend/config/` — backend configuration
- `backend/env/.env.example` — example environment setup

## Run the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload
```

## Supporting docs

- `backend/README.md`
- `docs/REPLIT_GITHUB_HANDOFF.md`

## What remains

The repo is beyond prototype stage, but it is not fully concluded yet. Remaining work includes:
- final frontend-to-backend wiring verification
- one clean repo story and documentation alignment
- deployment validation with green checks
- optional live-trading readiness work, kept disabled by default
- legal/compliance review before any public money-management or client-facing use
