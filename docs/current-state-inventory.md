# Current State Inventory

This inventory captures the implementation baseline for the public integration, waitlist, and command-centre compatibility work.

## Complete in this branch

| Area | Status |
|---|---|
| Provider registry | JSON-backed registry added in `backend/logic/provider_registry.py`. |
| Integration status API | `GET /api/v1/integrations/status` returns registered providers. |
| Waitlist API | `POST /api/v1/waitlist` validates emails, rejects duplicates, and persists JSON data. |
| Public frontend routes | `/public`, `/integrations`, and `/waitlist` are wired into the React router. |
| Compatibility API | `/api/account/summary`, `/api/signals/recent`, `/api/positions`, `/api/guardian/status`, and `/api/equity/history` are exposed through a compatibility router. |
| Tests | Backend tests cover the registry, integration status endpoint, and waitlist endpoint. |

## Current production baseline to preserve

| Area | Notes |
|---|---|
| Frontend | Vite, React, TypeScript, and Vercel analytics. |
| Backend | FastAPI trading backend with health, config, balances, positions, signals, guardian, audit, metrics, and paper/live intent surfaces. |
| Deployment | Render and Docker start from `backend.app:app`; package bootstrap attaches the new public routers without replacing the trading backend. |
| API client | Frontend pages use `src/lib/api.ts`, preserving the existing `VITE_BACKEND_URL` contract. |

## Remaining work

| Area | Next step |
|---|---|
| Public site | Expand placeholder pages into full market, education, pricing, risk, and support sections. |
| Provider health | Add active health checks and scheduled status updates. |
| Waitlist storage | Move JSON waitlist persistence to a durable database or CRM integration. |
| Compatibility schema | Align response objects exactly with any legacy command-centre clients. |
| Frontend tests | Add component-level tests for the public pages and error states. |
