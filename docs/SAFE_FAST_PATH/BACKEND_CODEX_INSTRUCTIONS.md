# Backend Codex Build Instruction

Copy this instruction into Codex while the repository is open on the `feat/safe-fast-path-standard` branch or a new branch created from it.

---

You are the backend implementation engineer for `support371/crypto-signal-bot`.

## Required reading

Before editing any file, read in this order:

1. `AGENTS.md`
2. `docs/SAFE_FAST_PATH/README.md`
3. `docs/SAFE_FAST_PATH/TARGET_ARCHITECTURE.md`
4. `docs/SAFE_FAST_PATH/API_CONTRACT.md`
5. `docs/SAFE_FAST_PATH/IMPLEMENTATION_PLAN.md`
6. `worker/src/index.ts`
7. `worker/src/index_with_d1.ts`
8. `wrangler.toml`
9. all files under `worker/migrations/`
10. current Worker tests and paper-safety scripts

Treat the existing implementation as the compatibility baseline and the SAFE_FAST_PATH documents as the target.

## Objective

Build the backend foundation for a WebSocket-first, sequence-safe, heartbeat-aware, low-latency simulation path using Cloudflare Workers, one Durable Object per portfolio, asynchronous Queue projections, D1 read models, and R2 replay storage.

Do not enable mainnet, live execution, withdrawals, or browser-held backend secrets.

## Execution rules

- Work only on a feature branch.
- Do not write to `main`.
- Do not deploy.
- Do not change production environment variables.
- Do not add real exchange credentials.
- Do not claim success without running the relevant checks.
- Preserve current public endpoints unless introducing the versioned `/v2` contract.
- Keep LLM calls outside the hot path.
- Never use static, cached, synthetic, stale, sequence-broken, or heartbeat-dead data for a new executable entry.
- Keep Queue operations outside the synchronous decision and portfolio-commit path.
- Use one Durable Object per portfolio, not a global singleton.

## First delivery scope

Implement Phases 1 and 2 only. Build the contracts, observability surface, normalized event model, integrity state machine, freshness rules, and fault tests. Do not make the Durable Object authoritative yet.

### Create these files

```text
worker/src/fast-path/types.ts
worker/src/fast-path/events.ts
worker/src/fast-path/feed-health.ts
worker/src/fast-path/freshness.ts
worker/src/fast-path/recovery.ts
worker/src/fast-path/normalizers/coinbase.ts
worker/src/fast-path/normalizers/binance.ts
worker/src/fast-path/index.ts
worker/src/routes/v2-infrastructure.ts
worker/src/routes/v2-market-feeds.ts
worker/src/routes/v2-metrics.ts
worker/tests/fast-path/events.test.ts
worker/tests/fast-path/feed-health.test.ts
worker/tests/fast-path/freshness.test.ts
worker/tests/fast-path/recovery.test.ts
worker/tests/contracts/v2-infrastructure.test.ts
```

If the existing test runner uses a different directory convention, preserve that convention and document the adjusted path.

### Update these files

```text
worker/src/index.ts
worker/src/index_with_d1.ts
worker/package.json
wrangler.toml
```

Update only what is required for the first delivery. Do not add a Durable Object binding until the Durable Object class exists in the later phase.

## Required types

Define a normalized market event with at least:

```ts
export type MarketSource = 'coinbase' | 'binance'
export type MarketEventKind = 'level2' | 'book_ticker' | 'trade' | 'heartbeat' | 'snapshot'
export type IntegrityState = 'healthy' | 'degraded' | 'resyncing' | 'unavailable' | 'not_reported'
export type FreshnessClass = 'green' | 'amber' | 'red' | 'not_reported'

export interface NormalizedMarketEvent {
  version: '2.0'
  eventId: string
  source: MarketSource
  channel: string
  kind: MarketEventKind
  symbol: string
  exchangeTsMs: number
  receivedTsMs: number
  sequenceStart?: number
  sequenceEnd?: number
  bid?: number
  ask?: number
  updates?: Array<{
    side: 'bid' | 'ask'
    price: number
    quantity: number
  }>
  rawDigest?: string
}
```

Define symbol/source feed state with:

- connection state;
- heartbeat state;
- sequence state;
- integrity state;
- last sequence;
- last exchange and receive timestamps;
- event age;
- gap count;
- recovery state and timestamps;
- last error code.

## Freshness behavior

Create pure functions that classify data:

- green: age at or below 500 ms and integrity healthy;
- amber: age above 500 ms and at or below 1500 ms;
- red: age above 1500 ms or integrity unhealthy;
- not_reported: required timestamps are absent.

Create separate action authorization functions:

- new entry requires green, healthy sequence, and healthy heartbeat;
- scale-in requires green plus a stricter risk flag;
- ordinary reduction requires healthy executable state;
- protective reduction may use amber only when a healthy secondary source confirms;
- static/cache fallback is never executable.

Keep thresholds in a typed configuration object so they can become versioned configuration later.

## Sequence behavior

For Coinbase:

- normalize level2 and heartbeat messages;
- track message sequence when available;
- mark the source degraded or resyncing when continuity cannot be guaranteed;
- heartbeat updates liveness but does not trigger feature or execution evaluation.

For Binance diff depth:

- support snapshot bootstrap metadata;
- buffer deltas while a snapshot is loading;
- apply only updates that bridge the snapshot update id;
- verify continuous update ids;
- hard reset and resync on a gap;
- reject stale buffered data after a recovery timeout.

Do not implement a fake full order book when only top-of-book data exists. Report limited capability honestly.

## Required `/v2` routes

Implement the response shapes in `docs/SAFE_FAST_PATH/API_CONTRACT.md`.

### `GET /v2/infrastructure/status`

Initially report:

- current paper/testnet safety state from existing runtime functions;
- guardian state;
- `fast_path.authority = legacy_d1`;
- `target_authority = portfolio_durable_object`;
- `shadow_mode = true` only when the new feed state is actively receiving test events;
- latency fields as `null` until measured;
- Queue state as `not_reported` until a Queue binding exists.

### `GET /v2/market/feeds/status`

Return real in-memory or persisted feed-health state. When no feed gateway is active, return an empty list and a top-level status explaining that the capability is not active. Do not fabricate connected feeds.

### `GET /v2/metrics/decision`

Return measured samples when available. Otherwise return zero sample count and null percentile values.

## Storage rules for this phase

- Do not use D1 as a high-frequency tick store.
- Feed health may be kept in bounded in-memory state for the initial implementation and exposed as ephemeral.
- Persist only low-frequency health transitions or summary snapshots if needed.
- Do not add a Queue to the critical path.
- Do not change current portfolio authority.

## Tests required before completion

Write deterministic tests for:

1. normal event parsing;
2. duplicate event handling;
3. out-of-order event handling;
4. sequence gap detection;
5. heartbeat timeout;
6. stale green-to-amber transition;
7. amber-to-red transition;
8. entry blocked on amber;
9. protective reduction allowed on amber only with healthy secondary confirmation;
10. static/cache fallback always non-executable;
11. recovery state returns to healthy after a valid snapshot bridge;
12. recovery timeout returns unavailable;
13. `/v2` routes never invent metrics or feed health;
14. existing paper-safety tests still pass;
15. existing health/runtime/order contracts remain compatible.

## Performance checks

Add a small deterministic benchmark or test utility that measures:

- normalization;
- sequence validation;
- freshness classification;
- feed-state update.

Report p50, p95, and p99 for a fixed replay fixture. Do not claim network or end-to-end platform latency from a local unit benchmark.

## Completion report

When done, provide:

- branch name;
- commit SHA;
- files created;
- files modified;
- tests run and exact results;
- benchmark results and environment;
- compatibility notes;
- known limitations;
- confirmation that no deployment occurred;
- confirmation that paper mode, testnet, mainnet block, and withdrawal block remain intact;
- exact next phase recommended.

Stop after Phases 1 and 2. Do not begin Durable Object authority, Queue projection, or execution-policy changes in the same pull request.

---
