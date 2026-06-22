# Backend Codex Instruction — Current Stage

**Current stage:** stabilize SAFE_FAST_PATH Phases 1–2 on draft PR #125  
**Repository:** `support371/crypto-signal-bot`  
**Working branch:** `feat/safe-fast-path-feed-integrity`  
**Base branch:** `feat/safe-fast-path-standard`  
**Pull request:** `#125`  
**Boundary:** paper/testnet simulation only; no deployment, mainnet, withdrawals, Durable Object authority, or Queue authority

Copy this entire instruction into Codex while the repository is open on `feat/safe-fast-path-feed-integrity`.

---

You are the backend stabilization engineer for `support371/crypto-signal-bot`.

## Required reading

Before editing any file, read in this order:

1. `AGENTS.md`
2. `docs/SAFE_FAST_PATH/README.md`
3. `docs/SAFE_FAST_PATH/TARGET_ARCHITECTURE.md`
4. `docs/SAFE_FAST_PATH/API_CONTRACT.md`
5. `docs/SAFE_FAST_PATH/IMPLEMENTATION_PLAN.md`
6. `docs/SAFE_FAST_PATH/BACKEND_CODEX_INSTRUCTIONS.md`
7. all files under `worker/src/fast-path/`
8. all files under `worker/src/routes/` beginning with `v2-`
9. `worker/src/index.ts`
10. `worker/src/index_with_d1.ts`
11. all files under `worker/tests/fast-path/`
12. all files under `worker/tests/contracts/`
13. `.circleci/config.yml`
14. `worker/package.json`, root `package.json`, and both lockfiles

Treat `BACKEND_CODEX_INSTRUCTIONS.md` as the original Phase 1–2 specification, not as a request to recreate files that already exist.

## Current verified state

Draft PR #125 already contains:

- normalized Coinbase and Binance market events;
- sequence, duplicate, out-of-order, and gap classification;
- heartbeat and feed-health state;
- green/amber/red freshness rules;
- fail-closed market-action authorization;
- Binance snapshot recovery state;
- bounded decision metrics;
- read-only `/v2/infrastructure/status`;
- read-only `/v2/market/feeds/status`;
- read-only `/v2/metrics/decision`;
- deterministic unit, recovery, contract, and benchmark tests;
- a CircleCI `worker-fast-path` lane.

The frontend build, Python backend checks, and canonical Vercel preview are passing. The current blocking item is the `worker-fast-path` CircleCI lane.

## Immediate objective

Diagnose and fix the failing `worker-fast-path` CI lane on PR #125.

Do not begin Phase 3 until every Phase 1–2 acceptance gate is verified and this PR is ready for review.

## Execution rules

- Work only on `feat/safe-fast-path-feed-integrity`.
- Do not write to `main`.
- Do not merge PR #122 or PR #125.
- Do not deploy.
- Do not change production environment variables.
- Do not add exchange credentials.
- Do not add a Durable Object binding.
- Do not add a Queue binding.
- Do not connect shadow feed events to the legacy order engine.
- Preserve D1 as the current ledger authority.
- Preserve paper mode, testnet, mainnet-disabled, live-disabled, and withdrawal-disabled behavior.
- Fix the smallest verified root cause; do not weaken tests to make CI green.
- Do not remove the Worker typecheck or paper-safety verification.
- Do not fabricate feed health, latency, or Queue readiness.

## Required diagnostic sequence

1. Inspect the failing CircleCI workflow and identify the exact failed command and first actionable error.
2. Reproduce the failing command locally in the repository environment when possible.
3. Check, in order:
   - root `npm ci` compatibility;
   - Vitest configuration and test environment isolation;
   - Worker test discovery;
   - TypeScript errors in `worker/src/fast-path/` and `/v2` routes;
   - Worker lockfile compatibility;
   - `npm --prefix worker run build`;
   - `npm --prefix worker run verify:paper-safety`.
4. Patch only the verified cause.
5. Run the complete required verification matrix.

## Required checks

Run and report exact results for:

```bash
npm ci
npm run test:worker
npm run lint
npm run build
npm --prefix worker ci
npm --prefix worker run build
npm --prefix worker run verify:paper-safety
```

Also verify the existing Python backend and repository checks remain green through CI.

## Phase 1–2 acceptance review

Before reporting completion, verify:

- duplicate events are rejected without advancing state;
- out-of-order events are rejected;
- skipped sequences enter resyncing state;
- heartbeat loss degrades the feed;
- recovery timeout becomes unavailable;
- valid Binance snapshot bridging returns healthy;
- green is at or below 500 ms with healthy integrity;
- amber is 501–1500 ms with healthy integrity;
- red is above 1500 ms or integrity-unhealthy;
- new entries are blocked outside green;
- scale-in requires stricter risk approval;
- protective reduction on amber requires healthy secondary confirmation;
- cache, static, and request-provided prices remain non-executable;
- `/v2` routes remain read-only;
- empty feed state is reported as inactive, not connected;
- absent metrics remain null or `not_reported`;
- Queue remains `not_reported`;
- authority remains `legacy_d1`;
- no shadow event mutates portfolio state;
- existing runtime, guardian, order, and portfolio compatibility remains intact.

## Review the implementation for hidden correctness gaps

While fixing CI, inspect and correct any confirmed issue in these areas:

- event-id collisions across channels or symbols;
- invalid timestamp normalization;
- sequence-range edge cases;
- heartbeat propagation across unrelated symbols;
- unbounded memory growth;
- recovery-buffer overflow behavior;
- recovery timeout behavior;
- CORS response consistency;
- Worker-isolate state being represented as durable state;
- metrics claiming end-to-end or network latency from local benchmarks;
- accidental executable use of cache/static/request prices.

Do not expand scope beyond confirmed Phase 1–2 correctness problems.

## Completion report

When all checks pass, report:

- branch name;
- final commit SHA;
- exact CI failure root cause;
- files changed;
- tests and exact results;
- Worker build result;
- paper-safety verification result;
- benchmark p50/p95/p99 and environment;
- compatibility results;
- known limitations;
- confirmation that no deployment occurred;
- confirmation that no Durable Object or Queue authority was added;
- confirmation that paper/testnet/mainnet/withdrawal safety remains intact;
- whether PR #125 is ready for human review.

## Stop condition

Stop after PR #125 is fully green and the Phase 1–2 completion report is produced.

Do not implement Phase 3 in PR #125.

After PR #125 is reviewed and merged into its intended base, the next work must use a new branch for Phase 3:

```text
feat/safe-fast-path-decision-shadow
```

Phase 3 will add bounded incremental features, evidence-only scouts, deterministic fusion, and centralized risk decisions in shadow mode. It must remain portfolio-non-mutating and must not introduce Durable Object or Queue authority.

---
