# Bitget Demo Operational Rehearsals — Migration 029

## Purpose

Migration 029 records evidence that five non-live operational scenarios were rehearsed against an exact code identity. It does not run an exchange operation, access a provider account, rotate a secret, deploy infrastructure, restore a production database, or authorize a release.

A complete pack can become only `READY_FOR_INDEPENDENT_REVIEW`.

## Scenarios

### 1. `ROLLBACK_TO_KNOWN_GOOD`

Evidence must show that a non-live candidate can be returned to a previously reviewed code and configuration identity while all provider, execution, funding, mainnet, withdrawal, retry, and accounting capabilities remain disabled.

The evidence record contains only a SHA-256 reference and observation timestamp. It contains no deployment token, command transcript, resource credential, or callable rollback mechanism.

### 2. `DISASTER_RECOVERY_RESTORE`

Evidence must show that immutable non-live evidence can be restored or reconstructed in an isolated rehearsal environment and then revalidated by hashes, append-only constraints, and capability locks.

The rehearsal must not claim restoration of a production provider connection or live account state.

### 3. `ACCESS_REFERENCE_ROTATION`

Evidence must show that a non-secret access reference or custody record can be superseded and independently reviewed without storing, displaying, transmitting, or testing a credential value.

The repository does not contain a credential-rotation implementation, provider key, passphrase, token, or secret-store mutation path.

### 4. `PROVIDER_OUTAGE_FAIL_CLOSED`

Evidence must show that unavailable, delayed, malformed, rate-limited, or ambiguous provider observations result in a blocked or review-required state with no automatic retry, mutation replay, accounting dispatch, or release inference.

No provider request is required to create the rehearsal record. External observation evidence must be independently supplied later.

### 5. `INCIDENT_ESCALATION_AND_CONTAINMENT`

Evidence must show that an incident can be classified, escalated for independent review, and kept contained while deployment, requests, credentials, mutations, execution, funding, mainnet, withdrawals, retries, and automatic accounting remain disabled.

The pack does not acknowledge or resolve alerts and cannot modify Guardian state.

## Evidence contract

Each scenario records only:

- fixed scenario name;
- pass/fail boolean;
- SHA-256 evidence reference or null;
- observation timestamp or null;
- permanent false capability flags.

A scenario passes only when its pass flag, evidence reference, and timestamp are all present and every capability remains false.

## Persistence

`live_bitget_demo_operational_rehearsal_packs` is append-only:

- exactly five scenarios;
- exact Git SHA;
- deterministic pack hash;
- bounded blockers;
- `BLOCKED` or `READY_FOR_INDEPENDENT_REVIEW` status;
- no-update and no-delete triggers;
- exact replay and conflicting-evidence rejection;
- permanent zero-capability constraints.

Migration verification applies the complete sequence through 029 from an empty database, upgrades from migration 019, replays migrations 020–029, inserts a blocked pack, and proves that the row cannot be updated or deleted.

## Operator visibility

`GET /v1/operator/operational-readiness` requires a global `RISK_ADMIN`, `AUDITOR`, or `RELEASE_ADMIN` role and exposes only:

- status and independent-review boolean;
- total, passed, and blocked counts;
- scenario names;
- pass and evidence-presence booleans;
- observation timestamps;
- blockers;
- Git SHA and preparation timestamps;
- permanent false capability flags.

It does not expose pack IDs, preparer IDs, evidence hashes, raw scenario JSON, secret references, provider payloads, or executable procedures.

## Current status

The repository can evaluate, persist, verify, and display rehearsal evidence. It has not performed an external infrastructure, identity-provider, credential-custody, provider-outage, or incident-response rehearsal. Those observations remain external blockers and cannot be fabricated by the codebase.
