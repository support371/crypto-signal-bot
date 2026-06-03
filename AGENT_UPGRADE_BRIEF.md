# AGENT UPGRADE BRIEF

**Target system:** `https://crypto-signal-bot-indol.vercel.app/`
**Reference spec:** `PROJECT_SPEC.md` (Lovable AI Risk Agent — Paper Crypto Simulator, 10/10 engineering specification).
**Mode:** Paper / simulation only. Live trading and withdrawals are explicitly out of scope.
**Definition of done:** All acceptance items in §4 pass on a clean checkout, and all eight deliverable docs in §1 Phase 8 are present and current in the repo.

The next agent must read this entire brief before touching code. Execute phases in order. Do not skip the audit.

---

## §0 Operating Rules (non-negotiable)

1. **Audit first, implement second.** Never rewrite a module before reading it.
2. **Small coherent diffs.** One concern per commit. Run build + tests after each phase.
3. **Preserve sound logic.** Feature extraction, signal classification, risk scoring, core dataclasses, and useful tests stay unless demonstrably broken.
4. **No fake success.** If live data is unavailable, return a typed safe-mode response (`{mode:"safe", reason}`) — never fabricate.
5. **Config owns thresholds.** No hardcoded operational numbers in code. All limits load from `AppConfig` (YAML + env overrides) at startup.
6. **Risk supremacy.** Risk logic overrides strategy logic. If risk blocks, strategy never executes.
7. **Paper/live parity.** Engine, policy, and risk modules are identical across modes. Only the adapter boundary differs.
8. **Determinism.** Same inputs → same `DecisionTrace`. Replay tests enforce this.
9. **Safe-mode default.** Live execution is gated off. `POST /orders` returns 403 outside paper mode.
10. **Naming.** User-facing copy says "Lovable Cloud" / "backend", never "Supabase".

---

## §1 Phase Plan

### Phase 1 — Audit
Crawl the deployed site and the repo. Produce:
- `ARCHITECTURE_AUDIT.md` — current modules, contracts, gaps, dead code, hardcoded thresholds.
- `REMEDIATION_PLAN.md` — prioritized fix list mapped to phases below.

### Phase 2 — Backend Foundations
Refactor into modules: `backend/{config,core,engine,policy,risk,reconciliation,adapters,audit,api,tests}`.
Implement:
- `AppConfig` loader (YAML + env overrides, validated via Pydantic).
- Canonical Pydantic models: `Tick`, `Features`, `Signal`, `RiskAssessment`, `Decision`, `Order`, `Fill`, `Position`, `DecisionTrace`.
- `ExchangeAdapter` Protocol + `PaperAdapter` implementation.
- Engine pipeline that emits a `DecisionTrace` per tick.
- Reconciliation job (drift detection between expected and observed state).
- Health + metrics services.

### Phase 3 — API Contract Cleanup
Implement and snapshot-test all 11 endpoints with exact response shapes:
`/health`, `/balance`, `/positions`, `/pnl`, `/portfolio`, `/signal/latest`, `/guardian/status`, `/orders` (GET + POST), `/audit`, `/metrics`, `/stream` (WS).
- Safe-mode returns `{mode:"safe", reason}`.
- `POST /orders` returns 403 outside paper mode.
- WS `/stream` emits tagged events (`tick`, `signal`, `decision`, `fill`, `health`) with heartbeats.

### Phase 4 — Frontend vNext
Standardize on React + TypeScript + Vite + Tailwind + shadcn.
Routes: `/` Landing → `/dashboard`, `/auth`, `/dashboard` (live grid), `/positions`, `/portfolio`, `/guardian`, `/audit` (with Replay), `/health`, `/settings`.
- Semantic HSL tokens only (no raw colors in components).
- Dark-first, responsive from 375px.
- Graceful degradation when backend is in safe mode or offline.

### Phase 5 — Auth & Security
- Email + Google via Lovable Cloud (managed Google OAuth).
- `user_roles` table + `has_role()` security-definer function (never store roles on profiles).
- RLS enforced on every user-scoped table; `user_id` NOT NULL.
- HIBP password protection enabled.
- Centralize edge-function calls through `src/lib/invokeEdgeFunction.ts` (handles auth + 401 recovery).

### Phase 6 — Persistence
- Postgres via Lovable Cloud.
- Append-only audit table with schema versioning (`schema_version` column).
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` on every table.
- Every `CREATE TABLE public.*` migration includes `GRANT` statements in the same migration.

### Phase 7 — Testing
- Unit (policy, risk, features).
- Integration (engine pipeline end-to-end).
- API contract (snapshot per endpoint).
- Deterministic replay (same fixture → byte-identical trace).
- Reconciliation (drift detection).
- Frontend smoke (route loads, auth gate, dashboard renders).
- **Never delete tests to make CI green.** Fix root causes.

### Phase 8 — Docs & Runbook
All present and current at repo root:
`ARCHITECTURE_AUDIT.md`, `REMEDIATION_PLAN.md`, `DECISION_TRACE_SPEC.md`, `API_CONTRACTS.md`, `FRONTEND_STRUCTURE.md`, `BACKEND_STRUCTURE.md`, `RUNBOOK_LOCAL.md`, `FINAL_CHANGELOG.md`.

---

## §2 Required Decision Flow

```
adapter.stream()
  → features = extract(tick, history)
  → signal   = classify(features)         # UP / DOWN / NEUTRAL + confidence
  → risk     = assess(features, portfolio, config)
  → decision = decide(signal, risk, config)
  → if decision.action != HOLD:
        order = size(decision, portfolio, config)
        fill  = adapter.execute(order)    # paper adapter only
  → trace    = DecisionTrace(features, signal, risk, decision, order?, fill?)
  → audit.append(trace)
  → ws.broadcast(trace)
```

**Hard risk rules — any single condition blocks the trade:**
- `regime == CHAOS`
- `realized_vol > config.risk.vol_cap`
- `drawdown_from_peak > config.risk.dd_cap`
- `exposure_after_trade > config.risk.exposure_cap`
- `cooldown_active`
- `spread > config.risk.spread_cap`
- `soft_score > config.risk.max_score`

---

## §3 Value & Earnings Model

- **Starting NAV:** $10,000 (paper).
- **Fees:** 5 bps per side.
- **Slippage:** `spread/2 + depth_impact(order_size, book)`.
- **P&L:** mark-to-market per tick; realized on fill.
- **Surface on `/portfolio`:** NAV curve, drawdown, Sharpe-like ratio, win rate, avg win/loss, fees paid, slippage paid.
- **Edge sources:** signal directional accuracy, risk gate filtering high-variance regimes, position sizing scaled by risk + trend strength, fees/slippage kept below gross edge.
- **Guardian as profit multiplier:** measured by counterfactual — NAV with Guardian vs NAV without, over the same fixture.

---

## §4 Acceptance Checklist (Definition of Done)

1. Zero console errors on any route in the deployed build.
2. Auth works end-to-end (email + Google), session persists, protected routes gated.
3. Engine runs continuously against the paper adapter without crashes for ≥1 hour.
4. Every API response is typed and matches its snapshot contract.
5. WS `/stream` runs ≥1 hour with no drops and emits heartbeats.
6. Audit replay reproduces portfolio state byte-identically from a fixture.
7. All eight deliverable docs present and current.
8. Test suite green: unit + integration + contract + replay + reconciliation + frontend smoke.
9. Lighthouse ≥90 on landing; dashboard responsive from 375px.
10. No hardcoded thresholds; config-driven; live execution disabled.

---

## §5 Communication Style (per phase)

At the end of each phase, report:
- **What changed** — bullet list of modules/files.
- **Why** — link to the audit finding or spec section.
- **Files touched** — paths only.
- **Tests run** — command + pass/fail summary.
- **Remaining risks** — known gaps carried to the next phase.

No prose victory laps. No re-stating the spec. Ship the diff, report the facts, move to the next phase.