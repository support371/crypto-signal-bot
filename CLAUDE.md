# Project Operating Contract

You are the primary implementation agent for this repository.

## Mission
Build the full new version of this project as a deterministic, auditable, risk-first platform with a polished frontend, a modular backend, strong test coverage, and production-grade developer ergonomics.

## Execution Mode
- Execute immediately.
- Do not stop at analysis.
- Audit first, then implement.
- Use small coherent diffs.
- Run tests/build/lint after each major phase.
- Fix failures before moving on.
- Prefer maintainability over cleverness.
- Preserve working core logic where it is already correct.

## Architecture Principles
- Determinism: same inputs must produce the same decisions.
- Risk supremacy: risk logic overrides strategy logic.
- Single source of truth: balances, positions, exposures, decisions, timestamps, and health must be authoritative and consistent.
- Paper/live parity: engine logic must be identical across modes; only the adapter boundary may differ.
- Explainability: every decision must emit a structured trace.
- Separation of concerns:
  - engine = orchestration only
  - policy = pure logic
  - risk = pure constraints
  - reconciliation = drift detection
  - audit/logging = replayability
  - exchange adapter = isolated boundary
  - config = startup-loaded, not hardcoded

## Hard Constraints
- Keep the system in simulation/paper-safe mode.
- Do not enable live trading or real-money execution.
- Do not wire withdrawal logic.
- Build clean interfaces so live adapters can be added later without changing core logic.
- No fake “success” values. If live data is unavailable, return explicit errors or safe simulated fixtures.
- No hardcoded operational thresholds in code when config should own them.

## Existing Assets To Preserve If Sound
- feature extraction logic
- signal classification logic
- risk scoring logic
- core dataclasses/models
- useful backend tests
- Docker and CI scaffolding that can be extended rather than replaced

## Target Deliverables
1. Full repository audit
2. Frontend vNext experience
3. Modular backend refactor
4. Config loader
5. Deterministic decision-trace objects
6. Reconciliation and health module
7. Audit persistence abstraction
8. API contract cleanup
9. Test suite expansion
10. Developer docs and runbooks

## Frontend Goals
- Build a premium vNext product surface.
- Include:
  - landing page
  - dashboard shell
  - balances view
  - positions view
  - signal status
  - guardian/risk status
  - audit/activity stream
  - health/metrics view
  - settings/config screen
- Use the repo’s existing frontend stack if present and viable.
- If the frontend is weak or absent, standardize on React + TypeScript + Vite.
- Keep components modular and reusable.
- No hardcoded “live” values in the production app path; use typed mock/dev fixtures only in a dedicated mock layer.

## Backend Goals
- Standardize on clear module boundaries.
- Refactor toward:
  - backend/config
  - backend/core
  - backend/engine
  - backend/policy
  - backend/risk
  - backend/reconciliation
  - backend/adapters
  - backend/audit
  - backend/api
  - backend/tests
- Add:
  - startup config loader
  - health service
  - metrics service
  - deterministic decision trace model
  - reconciliation reports
  - adapter interfaces
  - paper adapter implementation
  - repository/service boundaries where needed
- Maintain FastAPI if already present and sound.
- Keep websocket/update streaming if present and improve contract quality.

## Data and Persistence
- Introduce clean persistence abstractions.
- Prefer PostgreSQL-ready interfaces and migrations if the repo already points that way.
- Keep local dev simple.
- Preserve audit replayability and timestamp integrity.

## API Contract Goals
- Ensure consistent schemas for:
  - /health
  - /balance
  - /positions
  - /pnl
  - /signal/latest
  - /guardian/status
  - /orders
  - /audit
  - /metrics
- If an endpoint cannot serve real data in safe mode, return a typed safe-mode response, not silent fabrication.

## Testing Requirements
- Add or extend:
  - unit tests
  - integration tests
  - API contract tests
  - deterministic replay tests
  - reconciliation tests
- Never delete useful tests to make CI green.
- Fix root causes.

## Documentation Outputs
Produce and keep updated:
- ARCHITECTURE_AUDIT.md
- REMEDIATION_PLAN.md
- DECISION_TRACE_SPEC.md
- API_CONTRACTS.md
- FRONTEND_STRUCTURE.md
- BACKEND_STRUCTURE.md
- RUNBOOK_LOCAL.md
- FINAL_CHANGELOG.md

## Work Sequence
1. Audit repo and summarize current state.
2. Produce remediation plan with priorities.
3. Implement backend foundations first.
4. Build/refactor frontend around the cleaned contracts.
5. Wire tests, lint, build, and local run scripts.
6. Produce final handoff docs.

## Output Style
For each major phase:
- What you changed
- Why it was needed
- Files touched
- Tests run
- Remaining risks
