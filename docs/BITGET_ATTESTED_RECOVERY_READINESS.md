# Bitget Attested Recovery Readiness — Disabled Non-Live Candidate

## Scope

This document describes the immutable, non-mutating readiness checkpoint that follows an attested Bitget read-only recovery ingestion.

The checkpoint does not dispatch accounting, settle reservations, execute reconciliation, mutate Guardian, call Bitget, retry automatically, satisfy release certification, or enable live execution.

## Evidence prerequisites

A checkpoint can be evaluated only when D1 contains:

- an immutable Bitget read-only certification run;
- all eight mandatory certification checks;
- a source attestation classifying the run as either local fixture evidence or independently authorized isolated read-only evidence;
- an immutable attested recovery-ingestion binding;
- the matching complete and bounded recovery ingestion;
- one accounting-task intent for every recovered fill.

## Migration 024

`worker/migrations/024_live_bitget_attested_recovery_readiness.sql` adds append-only readiness checkpoints and readiness events.

Each checkpoint stores only identities, hashes, counts, statuses, timestamps, reasons, incident requirements, and permanent capability locks.

The supported states are:

- `PENDING_ACCOUNTING_REVIEW` — recovered fills still need independently reviewed accounting dispatch evidence;
- `PENDING_SETTLEMENT` — accounting exists, but a reservation attached to the internal order lacks settlement evidence;
- `PENDING_RECONCILIATION` — accounting and required settlement are complete, but reconciliation is missing or older than downstream evidence;
- `CLEAR` — accounting, required settlement, approved dispatch evidence, and fresh reconciliation are consistent;
- `HALT_FOR_REVIEW` — evidence is partial, failed, contradictory, corrupted, or reconciliation reports a mismatch.

A non-clear checkpoint older than fifteen minutes is marked as a stale backlog and requires incident evidence.

## Evaluator

`worker/src/live/bitget-attested-recovery-readiness.ts` independently reads and validates:

- the attested-recovery binding and all permanent locks;
- the recovery-ingestion identity, snapshot, count, and capability locks;
- accounting-task intents;
- immutable fill-accounting receipts;
- reservations associated with each recovered fill's internal order;
- immutable reservation-settlement receipts;
- the latest approved recovery-accounting dispatch outcome;
- the latest Bitget account/product reconciliation result.

The evaluator rejects:

- missing or duplicate task evidence;
- partial accounting or settlement receipts;
- accounting, settlement, dispatch, or reconciliation evidence with nonzero mutation capability;
- multiple reservations for one recovered fill;
- settlement evidence without a matching reservation;
- accounting receipts without approved dispatch evidence;
- partial or failed accounting dispatch;
- completed-dispatch count mismatches;
- invalid reconciliation reason JSON;
- stale reconciliation;
- changed evidence under an existing checkpoint identity.

The checkpoint and one append-only event are written in a single D1 batch. Identical evidence replays without another event.

## Observability

`worker/src/live/bitget-attested-recovery-readiness-observability.ts` reloads and re-hashes the immutable checkpoint before projecting observability.

Every checkpoint emits one idempotent readiness-status metric.

- A stale pending checkpoint opens or refreshes a deduplicated `WARNING` alert with a `RESTRICT_ACCOUNT` recommendation.
- A `HALT_FOR_REVIEW` checkpoint opens or refreshes a deduplicated `CRITICAL` alert with a `HALT_ACCOUNT` recommendation.
- A `CLEAR` checkpoint resolves the stable alert identity when an alert exists.
- A fresh pending checkpoint records the metric and takes no alert action.

Guardian recommendations are alert metadata only. The projector has no Guardian mutation dependency and returns `guardianMutationAllowed=false`.

Alert acknowledgment remains separately authorized and cannot dispatch accounting, settle reservations, retry recovery, reset Guardian, or unlock execution.

## Permanent locks

Migration 024, the evaluator, the incident projector, executable tests, and static verifiers require all of the following to remain false:

- automatic accounting dispatch;
- automatic reservation settlement;
- automatic reconciliation;
- release-certification projection;
- live certification;
- Guardian mutation;
- provider mutation;
- automatic retry;
- transfers;
- withdrawals;
- execution;
- credential persistence.

## Validation

The mandatory Worker matrix includes:

- readiness state and replay tests;
- stale-backlog incident tests;
- settlement, dispatch, and reconciliation mismatch tests;
- readiness observability tests;
- full and provider TypeScript compilation;
- the complete live-foundation suite;
- static readiness and observability safety proofs;
- all three disabled Worker dry-run bundles, including the route-less Bitget
  trade-credential quarantine.

## Activation boundary

This checkpoint is operational evidence only. A `CLEAR` result does not mean production activation is authorized, does not satisfy release certification automatically, and does not enable exchange mutation.

Mainnet trading and withdrawals remain disabled. No credentials are provisioned by this workflow, no exchange request is signed, and no order or funds movement is performed.
