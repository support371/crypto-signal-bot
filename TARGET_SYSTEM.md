# Crypto Signal Bot — Authoritative System Target

> **Agent entrypoint:** read this file before changing architecture, trading flow, portfolio state, risk logic, or infrastructure.

The canonical implementation target is `docs/SAFE_FAST_PATH/`.

## Preserved operating pattern

```text
Market streams
  -> integrity and freshness gate
  -> independent scout observations
  -> deterministic signal fusion
  -> risk engine (sole capital authority)
  -> per-portfolio state owner
  -> paper execution
  -> position guardian
  -> staged profit realization
  -> reusable cash + protected internal profit reserve
  -> asynchronous projections, monitoring, replay, and analytics
```

This pattern must be improved by increasing data quality, decision speed, atomicity, observability, and replayability. Do not bypass or collapse its responsibility boundaries.

## Non-negotiable authority rules

- Scouts observe and score. They never allocate capital or submit orders.
- Fusion ranks opportunities. It never allocates capital.
- The risk engine alone approves size and exposure.
- One coordinated portfolio writer applies paper fills and accounting mutations.
- The position guardian manages partial exits, full exits, trailing protection, cooldown, and de-risking.
- Realized profit may be internally swept into a protected reserve that is excluded from ordinary reuse.
- External withdrawals remain a separate operation and remain disabled in certification/paper mode.
- Static, stale, synthetic, heartbeat-dead, or sequence-broken prices are never valid for a new entry.
- LLM/agent reasoning stays outside the latency-critical decision path.

## Required reading order

1. `AGENTS.md`
2. `docs/SAFE_FAST_PATH/README.md`
3. `docs/SAFE_FAST_PATH/TARGET_ARCHITECTURE.md`
4. `docs/SAFE_FAST_PATH/API_CONTRACT.md`
5. `docs/SAFE_FAST_PATH/AGENT_MAINTENANCE_CONTRACT.md`
6. `docs/SAFE_FAST_PATH/IMPLEMENTATION_PLAN.md`
7. `docs/SAFE_FAST_PATH/BACKEND_CODEX_FULL_BUILD.md`

## Compatibility boundary

The target is a controlled migration, not a rewrite. Existing safe public behavior stays compatible until a versioned replacement is tested. New authority is introduced only in shadow/simulation form first, with evidence and rollback gates.
