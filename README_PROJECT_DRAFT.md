# Crypto Signal Bot

Crypto Signal Bot is a paper-mode crypto automation control center focused on opportunity detection, risk-governed execution, and backend-driven monitoring.

## Current architecture

- **Frontend shell:** maintained in Replit as the UI/control center
- **Backend source of truth:** maintained externally and integrated through GitHub
- **Operating mode:** paper trading only
- **Exchange placeholders:** Bitget and BTCC
- **Backend integration model:** external REST-style APIs consumed by the frontend

## Current frontend status

The frontend has been prepared for external backend integration:
- API typings added
- API service layer added
- Dashboard wired for backend metrics
- Watchlist wired for opportunities
- Positions wired for backend state
- Orders wired for backend state
- System Health wired for backend health data

## Backend target modules

The backend is designed around 6 modules:

1. Listener  
   Generates simulated market and listing events

2. Scorer  
   Converts events into ranked opportunities

3. Guardian  
   Applies hard risk rules and approval logic

4. Execution Router  
   Converts approved intents into simulated paper orders and positions

5. Audit Store  
   Persists events, scores, decisions, orders, fills, settings changes, and errors

6. Health API  
   Exposes module status, metrics, last cycle time, and mode

## API surface

- `GET /health`
- `GET /watchlist`
- `GET /positions`
- `GET /orders`
- `GET /audit`
- `GET /settings`
- `GET /state`
- `POST /settings`
- `POST /cycle`

## Important operating rules

- Default mode is **paper**
- No live trading
- No withdrawal logic
- Bitget and BTCC remain placeholder settings until real backend integration is approved and completed

## Supporting docs

- `backend/README.md`
- `docs/REPLIT_GITHUB_HANDOFF.md`

## Project direction

This project is being developed as a crypto automation control center with:
- event/listing awareness
- scoring and filtering
- hard risk governance
- simulated execution
- auditability
- backend-driven monitoring

The frontend is now API-ready. The next development priority is landing the backend scaffold cleanly in GitHub and connecting the frontend to the external backend contract.
