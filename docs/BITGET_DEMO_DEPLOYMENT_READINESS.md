# Bitget Demo Non-Live Deployment Readiness — Migration 028

## Purpose

Migration 028 and `demo-deployment-readiness.ts` create an immutable review packet for a future isolated Bitget demo-certification deployment.

A complete packet means only `READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW`. It never means deployment is authorized, a demo request may be sent, credentials may be read, or provider mutation is enabled.

## Fourteen checks

The manifest requires:

1. an exact 40- or 64-character Git SHA;
2. candidate configuration evidence;
3. isolated D1 evidence;
4. isolated R2 evidence;
5. isolated KV evidence;
6. account rate-limit Durable Object namespace evidence;
7. account serializer evidence;
8. callback-scoped credential-lease adapter evidence;
9. GET-only recovery adapter evidence;
10. demo fetch-policy evidence;
11. trusted clock-policy evidence;
12. security-review reference evidence;
13. deployment-review reference evidence;
14. independently attested external Bitget read-only evidence.

Resource, adapter, and review references are represented only by SHA-256 evidence hashes. The manifest does not contain resource credentials, secret values, provider payloads, or callable transports.

## External evidence validation

The external attestation must independently resolve to:

- `ISOLATED_READ_ONLY_CLIENT` source mode;
- `SHADOW`, `TESTNET`, or `LIVE_CANDIDATE` environment;
- an authorized operator and authorization-event hash;
- a `PASSED` Bitget run;
- complete read-only evidence;
- verified read-only permissions;
- exactly eight passing certification checks;
- zero certification projection, live certification, provider mutation, retry, transfer, withdrawal, execution, and credential-persistence capability.

Fixture and local-only evidence cannot satisfy this check.

## States

- `BLOCKED`: one or more checks are missing or invalid.
- `READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW`: all fourteen checks are present and internally consistent.

Both states retain all capability locks. Review-ready does not authorize deployment.

## Permanent locks

Every manifest constrains the following to zero or false:

- deployment allowed;
- demo request allowed;
- credentials read;
- credentials persisted;
- provider mutation allowed;
- execution allowed;
- live execution allowed;
- real funds allowed;
- mainnet allowed;
- withdrawals allowed;
- automatic retry allowed;
- automatic accounting dispatch.

## Persistence

`live_bitget_demo_deployment_readiness_manifests` is append-only with:

- exact manifest hash;
- deterministic checks and blockers;
- no-update and no-delete triggers;
- exact replay support;
- conflicting-evidence rejection;
- an optional foreign key to a validated external read-only attestation.

Migration verification applies the sequence through 028 from an empty database, upgrades from migration 019, replays migrations 020–028, inserts a blocked manifest, and proves it cannot be updated or deleted.

## Current project status

The code can create and validate readiness manifests, but the project does not currently have all required external evidence. In particular, no isolated candidate deployment or external Bitget demo-certification request has occurred.
