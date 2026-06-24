# Safe Fast Path — Architecture Control Center

**Status:** Phases 1–2 implemented in paper-mode shadow form  
**Scope:** Cloudflare Worker, Durable Objects, D1 projections, Queues, observability, and React operator UI  
**Boundary:** simulation mode only; mainnet operations and withdrawals remain disabled

This folder is the authoritative location for the repository's low-latency architecture standard. Any agent, engineer, reviewer, or operator should begin with the root `AGENTS.md`, then read this folder in order.

## Read order

1. `TARGET_ARCHITECTURE.md` — system shape and invariants.
2. `API_CONTRACT.md` — frontend/backend contracts.
3. `IMPLEMENTATION_PLAN.md` — phased work, tests, gates, and rollback.
4. `BACKEND_CODEX_INSTRUCTIONS.md` — original Phase 1–2 build specification and implementation reference.

## Current implementation boundary

The Phase 1–2 implementation now includes normalized Coinbase and Binance events, sequence and heartbeat integrity state, bounded recovery and metrics state, freshness authorization, deterministic tests, and read-only `/v2` status routes.

The implementation remains a shadow path:

- D1 remains the existing portfolio and ledger authority.
- No Durable Object or Queue authority has been enabled.
- No shadow market event can mutate a portfolio.
- Missing feed or latency data is reported as inactive, `null`, or `not_reported`.
- Phase 3 must be developed in a separate focused branch after all Phase 1–2 acceptance gates pass.

## Target flow

```text
WebSocket market ingest
  -> sequence, heartbeat, and age validation
  -> incremental features and independent scouts
  -> deterministic fusion
  -> authoritative risk decision
  -> per-portfolio Durable Object transaction
  -> simulated fill, position, accounting, and protected reserve
  -> asynchronous Queue fan-out
  -> D1/R2 projections and frontend read models
```

## Required outcomes

- No new position may be created from stale, static, synthetic, sequence-broken, or heartbeat-dead data.
- Internal decision latency and source-event age are measured separately.
- One coordinated state owner mutates each portfolio.
- One fill maximum is allowed per idempotency key.
- Balance, position, fill, realized result, and reserve changes are atomic.
- The guardian remains authoritative.
- Queue consumers remain outside the critical decision path.
- Unknown backend capabilities are displayed as `not_reported`, never invented as healthy.

## Migration principle

This is a controlled migration, not a rewrite. Existing public routes remain compatible until versioned replacements are ready. New components first run in shadow or simulation mode. Every phase must have tests, evidence, and an independent rollback boundary.

## Review policy

- Use focused feature branches.
- Do not combine storage authority, execution authority, model experiments, and UI redesign in one pull request.
- Keep pull requests in draft until their acceptance gates pass.
- Deployment remains a separate explicit action after merge readiness is verified.
