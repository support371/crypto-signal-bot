# Repository Execution TODO

This file is the canonical execution brief for the next coding agent working on this repository.

## GitHub Copilot execution instruction

```text
You are the implementation engineer for this project. Do not stop at analysis. Do not return recommendations only. Build the application to a working finish.

Treat README_PROJECT_DRAFT.md as stale/conflicting documentation, reconcile docs to the actual current repo state, and fix docker-compose/env handling if backend/env/.env is missing.

PROJECT TARGET
Finish this project into a runnable, functioning full-stack crypto trading control center. The frontend must work. The backend must work. The frontend must be fully wired to the backend. The app must function end to end in paper mode by default, with live or testnet execution only behind explicit configuration flags.

CURRENT FOUNDATION
- Frontend: Vite + React control-center UI
- Backend: FastAPI
- Existing backend foundation already includes paper trading, synthetic pricing, audit trail, signal logic, risk logic, metrics, and websocket infrastructure
- Existing core logic already includes feature extraction, signal classification, risk scoring, execution intent models, and a paper portfolio engine
- The target architecture requires prediction service, guardian service, config-driven runtime, authenticated write endpoints, rate-limited read endpoints, and complete frontend/backend integration

YOUR JOB
Build everything necessary to make this app start working and functioning as a complete local full-stack application. Do not leave the work at architecture level. Modify files directly. Create missing files. Fix broken code. Run tests and builds. Continue until the app works.

MANDATORY DELIVERY RULES
- Do not pause at analysis
- Do not ask for permission to continue
- Do not leave placeholders where you can implement real code
- Do not break paper-mode behavior
- Keep live trading disabled by default unless explicit config/env enables testnet or live adapter
- Keep all secrets out of code
- Update README with exact run steps
- At the end, provide a concise summary of what was built, what files changed, and exact run commands

IMPLEMENTATION OBJECTIVES

1. STABILIZE THE EXISTING CODEBASE
- Inspect the current repo structure
- Fix broken imports, stale references, path issues, and runtime mismatches
- Ensure backend starts cleanly
- Ensure frontend starts cleanly
- Ensure frontend production build passes
- Ensure frontend can reach backend through the configured API base URL
- Ensure backend CORS works for the frontend dev server

2. COMPLETE THE BACKEND AS A REAL WORKING SERVICE
Implement and finish these backend capabilities:
- config loader using YAML plus environment overrides
- prediction service
- guardian service
- exchange adapter abstraction
- paper execution adapter as default
- optional CCXT testnet/live adapter behind explicit config flag only
- audit persistence service
- health and status service
- websocket event broadcasting
- authentication middleware for write endpoints
- rate limiting for read endpoints

3. COMPLETE OR FIX THE API SURFACE
Ensure these routes exist and work with consistent JSON responses:
- GET /health
- GET /config
- GET /balance
- GET /positions
- GET /orders
- GET /price
- GET /audit
- GET /metrics
- GET /signal/latest
- GET /guardian/status
- POST /market-state
- POST /intent/paper
- POST /intent/live
- POST /kill-switch
- POST /withdraw
- WS /ws/updates

Rules for API behavior:
- GET endpoints can be open but must be rate-limited
- POST endpoints must require authentication
- If data is unavailable, return explicit errors instead of fake success values
- Keep the API consistent with the current frontend and extend the frontend where needed

4. COMPLETE THE FRONTEND/BACKEND WIRING
Wire the frontend to live backend data for:
- health
- backend connection state
- balances
- positions
- orders
- latest signal
- guardian status
- audit trail
- kill switch state
- websocket updates
- loading and error handling for all panels

Frontend rules:
- Remove dead placeholders where backend data exists
- Keep the UI functional and stable
- Do not hardcode fake working values
- Make the dashboard actually reflect backend state

5. PREDICTION AND GUARDIAN INTEGRATION
Prediction service must:
- consume market state
- produce direction, confidence, regime, horizon, and sizing guidance
- expose the latest output through API
- publish updates for websocket clients when relevant

Guardian service must:
- evaluate drawdown, risk score, API failures, order failures, and kill-switch conditions
- override trading when risk conditions are breached
- expose current guardian state and last trigger reason
- broadcast guardian alerts through websocket
- halt execution in paper mode when triggered

6. CONFIGURATION AND SECURITY
- Centralize operational settings in config
- Move scattered hardcoded operational values into config where practical
- Add environment examples
- Keep write actions authenticated
- Keep secrets out of git
- Keep live/testnet disabled unless explicitly enabled

7. LOCAL DEPLOYABILITY
- Add or fix Docker Compose for local full-stack startup
- Include backend, frontend, and Redis only if used
- Ensure the app can be run locally without guesswork
- Update README with exact commands for:
  - backend run
  - frontend run
  - docker run
  - tests
  - production build

8. TESTING AND VALIDATION
Add or update tests for:
- health endpoint
- auth enforcement on POST endpoints
- rate limiting on GET endpoints
- signal endpoint
- guardian status endpoint
- paper intent execution
- kill switch behavior
- websocket smoke behavior where practical

Run all of the following before stopping:
- backend tests
- frontend production build
- any available smoke checks

Fix failures until green.

DEFINITION OF DONE
Do not stop until all of the following are true:
- backend starts successfully
- frontend starts successfully
- frontend connects to backend successfully
- paper trading flow works end to end
- signal and guardian endpoints return usable real backend data
- websocket updates function
- authenticated write endpoints work
- read endpoints are rate-limited
- tests pass
- frontend build passes
- README contains exact run instructions
- the app is materially working as a local full-stack application

FINAL OUTPUT REQUIREMENT
When finished, return:
1. what was implemented
2. files changed and files added
3. exact commands to run backend
4. exact commands to run frontend
5. exact commands to run tests
6. any remaining blocker, only if truly unavoidable

Do the implementation now. Do not stop at analysis.
```

## Agent handoff note

The next agent should treat this file as the active repository to-do list and execution brief.
